"""Loopback-only review and explicit promotion into Polya's static catalog."""
import hashlib
import io
import json
import logging
import re
import secrets
import os
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

from PIL import Image

from workbench import (HERE, ROOT, Comfy, ComfyError, atomic_write, bindings, copy_candidate, create_batch,
                       execute_batch, queue_count, read_json, save_json, varied_jobs)


class CreateRejected(ValueError):
    def __init__(self, code, message, cause=None):
        super().__init__(message)
        self.code = code
        self.cause = type(cause).__name__ if cause is not None else '-'


def webp_file(source, maximum, quality):
    with Image.open(source) as image:
        image.thumbnail((maximum, maximum), Image.Resampling.LANCZOS)
        stream = io.BytesIO()
        image.save(stream, 'WEBP', quality=quality, method=6)
        return stream.getvalue()


def offline_files(root, catalog):
    import base64

    data = root / 'data'
    library = {key: read_json(data / f'{key}.json')
               for key in ['subject', 'place', 'mood', 'detail', 'technique', 'palette']}
    mime = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
            '.webp': 'image/webp', '.svg': 'image/svg+xml'}
    images = {}
    for entry in read_json(data / 'art.json') + catalog:
        path = root / entry['src']
        encoded = base64.b64encode(path.read_bytes()).decode('ascii')
        images[entry['id']] = f'data:{mime[path.suffix.lower()]};base64,{encoded}'

    def js(value):
        return json.dumps(value, ensure_ascii=False, separators=(',', ':'))

    atomic_write(data / 'offline.js', ('// Generated from the JSON libraries for opening index.html directly.\n'
                 f'const offlineIdeaLibrary = {js(library)};\n'
                 f'const offlineReferenceCatalog = {js(catalog)};\n').encode())
    atomic_write(data / 'offline-art.js', ('// Generated for direct file:// opening.\n'
                 f'const offlineArtSources = {js(images)};\n').encode())


def publish_candidate(folder, root=ROOT):
    job_file = folder / 'candidate.json'
    job = read_json(job_file)
    if job['status'] != 'ready' or job.get('review') not in ('selected', 'imported'):
        raise ValueError('Сначала отметьте готового кандидата как выбранного.')
    original = folder / 'original.png'
    digest = hashlib.sha256(original.read_bytes()).hexdigest()
    asset_id = f'comfy-{digest[:24]}'
    path = root / 'data' / 'reference-catalog.json'
    catalog = read_json(path)
    webp = webp_file(original, 1024, 84)
    existing = next((item for item in catalog if item.get('sourceHash') == digest or item['id'] == asset_id
                     or (root / item['src']).read_bytes() == webp), None)
    if not existing:
        entry = {key: job[key] for key in ('title', 'technique', 'themes', 'moods', 'palette', 'composition', 'directions')}
        entry.update(id=asset_id, src=f'data/references/{asset_id}.webp', sourceHash=digest,
                     source='Локальная генерация ComfyUI · SDXL')
        atomic_write(root / entry['src'], webp)
        catalog.append(entry)
        offline_files(root, catalog)
        save_json(path, catalog)
    job.update(review='imported', catalog_id=(existing or entry)['id'])
    save_json(job_file, job)
    return job['catalog_id']


def serve(state, review_port, port=8188, workflow=HERE / 'sdxl_api.json', prompts=HERE / 'prompts.json', timeout=900, launch=False):
    access = secrets.token_urlsafe(32)
    host = f'127.0.0.1:{review_port}'
    manager_lock = threading.Lock()
    import_lock = threading.Lock()
    current = {'batch': None, 'running': False, 'error': None}
    # Keep this process's planner and its data together across on-disk edits.
    try:
        prompt_config = read_json(prompts)
        prompt_error = None
    except (OSError, ValueError) as error:
        prompt_config = None
        prompt_error = error

    def job_file(ident):
        return state / 'candidates' / ident / 'candidate.json'

    def batch_file(ident):
        return state / 'batches' / ident / 'batch.json'

    def start(action, ident=None, count=None):
        with manager_lock:
            if current['running']:
                if action == 'create':
                    raise CreateRejected('batch_running', 'Дождитесь остановки или завершения текущей партии.')
                raise ValueError('Дождитесь остановки или завершения текущей партии.')
            args = SimpleNamespace(state=state, port=port, timeout=timeout)
            if action == 'resume':
                read_json(batch_file(ident))
                batch_id = ident
            elif action == 'repeat':
                batch = read_json(batch_file(ident))
                args.port = batch['port']
                graph = read_json(batch_file(ident).with_name('workflow.json'))
                batch_id = create_batch(args, graph, (copy_candidate(read_json(job_file(key))) for key in batch['jobs']), 'repeat')
            elif action == 'retry':
                old = read_json(job_file(ident))
                if old['status'] not in ('ready', 'failed'):
                    raise ValueError('Сначала завершите исходную партию.')
                graph = read_json(workflow)
                if old.get('batch_id'):
                    batch = read_json(batch_file(old['batch_id']))
                    args.port = batch['port']
                    graph = read_json(batch_file(batch['id']).with_name('workflow.json'))
                batch_id = create_batch(args, graph, [copy_candidate(old)], 'retry')
            else:
                if type(count) is not int or not 1 <= count <= 1000:
                    raise CreateRejected('invalid_count', 'Укажите целое число от 1 до 1000.')
                if prompt_error:
                    raise CreateRejected('prompts_unreadable', 'Не удалось прочитать файл промптов. Проверьте JSON и перезапустите мастерскую.', prompt_error)
                try:
                    graph = read_json(workflow)
                    bindings(graph)
                except (ValueError, OSError, KeyError, TypeError) as error:
                    raise CreateRejected('invalid_workflow', f'Не удалось подготовить SDXL workflow. {error}', error) from error
                try:
                    jobs = varied_jobs(prompt_config, count, state)
                except (ValueError, OSError, KeyError, TypeError) as error:
                    raise CreateRejected('invalid_plan', f'Не удалось составить план. {error}', error) from error
                try:
                    batch_id = create_batch(args, graph, jobs, 'batch')
                except OSError as error:
                    raise CreateRejected('batch_write_failed', f'Не удалось сохранить партию. {error}', error) from error
            if action == 'resume':
                batch_file(batch_id).with_name('stop').unlink(missing_ok=True)
            current.update(batch=batch_id, running=True, error=None)

            def run():
                error = None
                try:
                    execute_batch(args, batch_id, clear_stop=False)
                except Exception as failure:
                    error = str(failure)
                finally:
                    with manager_lock:
                        current.update(running=False, error=error)

            threading.Thread(target=run, daemon=True).start()
            return batch_id

    class ReviewHandler(BaseHTTPRequestHandler):
        def create(self):
            try:
                try:
                    size = int(self.headers.get('Content-Length', '0'))
                except ValueError as error:
                    raise CreateRejected('invalid_length', 'Неверный размер запроса.', error) from error
                if not 0 < size <= 1024:
                    raise CreateRejected('invalid_length', 'Запрос должен содержать количество изображений.')
                try:
                    body = json.loads(self.rfile.read(size))
                except ValueError as error:
                    raise CreateRejected('invalid_json', 'Запрос должен содержать корректный JSON.', error) from error
                if not isinstance(body, dict):
                    raise CreateRejected('invalid_body', 'Ожидается JSON-объект с полем count.')
                return self.json({'batch': start('create', count=body.get('count'))})
            except CreateRejected as error:
                logging.warning('POST /api/create HTTP 400 reason=%s exception=%s', error.code, error.cause)
                return self.json({'error': str(error), 'code': error.code}, 400)

        def log_request(self, code='-', size='-'):
            if str(code).startswith(('4', '5')):
                super().log_request(code, size)

        def send(self, status, data, content_type):
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            self.wfile.write(data)

        def json(self, value, status=200):
            self.send(status, json.dumps(value, ensure_ascii=False).encode(), 'application/json; charset=utf-8')

        def do_GET(self):
            if self.headers.get('Host') != host:
                return self.json({'error': 'Неверный локальный адрес.'}, 403)
            try:
                if self.path == '/':
                    page = (HERE / 'review.html').read_text(encoding='utf-8').replace('__ACCESS__', access)
                    return self.send(200, page.encode(), 'text/html; charset=utf-8')
                if self.path == '/api/candidates':
                    files = (state / 'candidates').glob('*/candidate.json')
                    return self.json([read_json(file) for file in sorted(files, key=lambda p: p.stat().st_mtime, reverse=True)])
                if self.path == '/api/workshop':
                    files = (state / 'batches').glob('*/batch.json')
                    batches = [read_json(file) for file in sorted(files, key=lambda p: p.stat().st_mtime, reverse=True)]
                    with manager_lock:
                        running = dict(current)
                    return self.json({'batches': batches, 'current': running, 'folder': str(state.resolve())})
                if self.path == '/api/connection':
                    api = Comfy(port)
                    try:
                        stats = api.request('/system_stats')
                        return self.json({'connected': True, 'device': next((dev['name'] for dev in stats.get('devices', [])), ''),
                                          'queue': queue_count(api.request('/queue')), 'port': port})
                    except ComfyError as error:
                        return self.json({'connected': False, 'error': str(error), 'port': port})
                match = re.fullmatch(r'/candidate/([a-f0-9]{32})/(thumb|image|parameters)', self.path)
                if match:
                    ident, kind = match.groups()
                    folder = state / 'candidates' / ident
                    if kind == 'parameters':
                        return self.json(read_json(folder / 'parameters.json'))
                    original = folder / 'original.png'
                    if kind == 'thumb':
                        thumbnail = folder / 'thumb.webp'
                        if not thumbnail.exists():
                            atomic_write(thumbnail, webp_file(original, 320, 76))
                        return self.send(200, thumbnail.read_bytes(), 'image/webp')
                    return self.send(200, original.read_bytes(), 'image/png')
            except (ValueError, OSError) as error:
                return self.json({'error': str(error)}, 404)
            self.json({'error': 'Не найдено.'}, 404)

        def do_POST(self):
            if (self.headers.get('Host') != host or self.headers.get('Origin') != f'http://{host}'
                    or not secrets.compare_digest(self.headers.get('X-Polya-Token', ''), access)):
                return self.json({'error': 'Действие доступно только на локальной странице.'}, 403)
            if self.path == '/api/create':
                return self.create()
            try:
                if self.path == '/api/open-folder':
                    state.mkdir(parents=True, exist_ok=True)
                    os.startfile(state.resolve())
                    return self.json({'ok': True})
                batch_action = re.fullmatch(r'/api/batch/([a-f0-9]{32})/(stop|resume|repeat)', self.path)
                if batch_action:
                    ident, action = batch_action.groups()
                    if action == 'stop':
                        with manager_lock:
                            if not current['running'] or current['batch'] != ident:
                                raise ValueError('Эта партия сейчас не выполняется.')
                            atomic_write(batch_file(ident).with_name('stop'), b'')
                        return self.json({'ok': True})
                    return self.json({'batch': start(action, ident)})
            except (ValueError, OSError, KeyError, ComfyError) as error:
                return self.json({'error': str(error)}, 400)
            match = re.fullmatch(r'/api/candidate/([a-f0-9]{32})/(selected|rejected|import|retry)', self.path)
            if not match:
                return self.json({'error': 'Не найдено.'}, 404)
            ident, action = match.groups()
            folder = state / 'candidates' / ident
            try:
                if action == 'import':
                    with import_lock:
                        return self.json({'catalog_id': publish_candidate(folder)})
                if action == 'retry':
                    return self.json({'batch': start('retry', ident)})
                file = folder / 'candidate.json'
                job = read_json(file)
                if job['status'] != 'ready' or job.get('review') == 'imported':
                    raise ValueError('Статус этого кандидата изменить нельзя.')
                with import_lock:
                    job = read_json(file)
                    if job.get('review') == 'imported':
                        raise ValueError('Кандидат уже в каталоге.')
                    job['review'] = action
                    save_json(file, job)
                return self.json({'review': action})
            except (ValueError, OSError, KeyError) as error:
                self.json({'error': str(error)}, 400)

    with ThreadingHTTPServer(('127.0.0.1', review_port), ReviewHandler) as server:
        print(f'Отбор референсов: http://{host}/', flush=True)
        if launch:
            threading.Thread(target=webbrowser.open, args=(f'http://{host}/',), daemon=True).start()
        server.serve_forever()
