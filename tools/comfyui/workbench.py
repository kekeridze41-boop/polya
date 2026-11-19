"""Local ComfyUI reference workbench for Polya."""
import argparse
import copy
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import msvcrt
import os
import random
import sys
import time
import tempfile
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from PIL import Image
from planner import DIRECTIONS, plan_jobs

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
DEFAULT_STATE = Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'Polya' / 'comfyui'


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f'.{path.name}.{uuid.uuid4().hex}.tmp')
    try:
        temporary.write_bytes(data)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def save_json(path, data):
    atomic_write(path, (json.dumps(data, ensure_ascii=False, indent=2) + '\n').encode())


class ComfyError(RuntimeError):
    pass


class ComfyHTTPError(ComfyError):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class Comfy:
    def __init__(self, port):
        self.url = f'http://127.0.0.1:{port}'

    def request(self, path, payload=None, raw=False):
        body = json.dumps(payload).encode() if payload is not None else None
        try:
            with urlopen(Request(self.url + path, data=body,
                                 headers={'Content-Type': 'application/json'}), timeout=25) as response:
                result = response.read()
        except HTTPError as error:
            detail = error.read().decode(errors='replace')[:4000]
            raise ComfyHTTPError(error.code, f'ComfyUI {path}: HTTP {error.code}. {detail}') from error
        except (URLError, TimeoutError, OSError) as error:
            raise ComfyError(f'ComfyUI {self.url}{path} недоступен: {error}') from error
        return result if raw else json.loads(result)

    def check(self):
        stats = self.request('/system_stats')
        queue = self.request('/queue')
        print('ComfyUI:', stats.get('system', {}).get('comfyui_version', '?'), self.url, flush=True)
        for device in stats.get('devices', []):
            print(f"  {device['name']} · {device.get('vram_free', 0) / 2**30:.1f} GiB свободно", flush=True)
        print('Очередь:', queue_count(queue), flush=True)


def queue_count(queue):
    return len(queue['queue_running']) + len(queue['queue_pending'])


def bindings(graph):
    if not isinstance(graph, dict) or not graph or any(
        not isinstance(node, dict) or 'class_type' not in node or 'inputs' not in node for node in graph.values()
    ):
        raise ValueError('Ожидается workflow, экспортированный в API-формате ComfyUI.')
    saved = {key for key, node in graph.items() if node['class_type'] == 'SaveImage'}
    if len(saved) != 1:
        raise ValueError('Workflow должен содержать ровно один SaveImage.')
    positive, negative, seeds = set(), set(), []
    for key, node in graph.items():
        kind, inputs = node['class_type'], node['inputs']
        if kind in ('EmptyLatentImage', 'EmptySDXLLatentImage') and inputs.get('batch_size') != 1:
            raise ValueError('Укажите batch_size=1 в экспортируемом workflow.')
        if kind not in ('KSampler', 'KSamplerAdvanced'):
            continue
        for name, target in [('positive', positive), ('negative', negative)]:
            link = inputs.get(name)
            encoder = graph.get(str(link[0])) if isinstance(link, list) and len(link) == 2 else None
            if not encoder or encoder['class_type'] != 'CLIPTextEncode' or not isinstance(encoder['inputs'].get('text'), str):
                raise ValueError(f'{kind}: вход {name} должен вести напрямую к CLIPTextEncode с текстом.')
            target.add(str(link[0]))
        if kind == 'KSampler' or inputs.get('add_noise') == 'enable':
            field = 'seed' if kind == 'KSampler' else 'noise_seed'
            if not isinstance(inputs.get(field), int):
                raise ValueError(f'{kind}: ожидается числовой {field}.')
            seeds.append((key, field))
    if not seeds or not positive or positive & negative:
        raise ValueError('Не удалось однозначно определить независимые промпты и активный seed.')
    return positive, negative, seeds, saved


def candidate_graph(graph, job):
    positive, negative, seeds, _ = bindings(graph)
    result = copy.deepcopy(graph)
    for keys, value in [(positive, job['positive']), (negative, job['negative'])]:
        for key in keys:
            result[key]['inputs']['text'] = value
    for key, field in seeds:
        result[key]['inputs'][field] = job['seed']
    return result


def token():
    return uuid.uuid4().hex


def smoke_job():
    return dict(id=token(), status='pending', prompt_id=None, seed=random.randrange(2**48),
                positive='Unfinished graphite study of a bicycle resting against a wall, two overlapping wheels, cheap notebook paper, irregular construction lines, generous empty space, observational drawing',
                negative='text, watermark, photorealism, glossy rendering', title='Велосипед у стены',
                technique='Карандаш, графит', themes=['велосипед', 'улица'], moods=['спокойствие'],
                composition=['свободное пространство'], palette=['#e8dfcc', '#76746d', '#383735'], directions=['daily'])


def run_candidate(api, graph, job, folder, persist, timeout):
    deadline = time.monotonic() + timeout
    if job['status'] == 'pending':
        while queue_count(api.request('/queue')):
            if time.monotonic() >= deadline:
                raise ComfyError('Очередь ComfyUI занята. Возобновите пакет после освобождения очереди.')
            time.sleep(2)
        workflow = candidate_graph(graph, job)
        # Keep the exact graph independent of later edits to the imported workflow.
        save_json(folder / 'parameters.json', workflow)
        job.update(status='submitted', prompt_id=str(uuid.uuid4()))
        persist()
        try:
            response = api.request('/prompt', {'prompt': workflow, 'prompt_id': job['prompt_id'], 'client_id': job['id']})
        except ComfyHTTPError as error:
            if 400 <= error.status < 500:
                job.update(status='failed', error=str(error))
                persist()
            raise
        job['prompt_id'] = response['prompt_id']
        persist()

    prompt_id = job['prompt_id']
    print(f"  {job['title']} · seed {job['seed']} · {prompt_id}", flush=True)
    empty_polls = 0
    while time.monotonic() < deadline:
        record = api.request('/history/' + prompt_id).get(prompt_id)
        if record:
            state = record.get('status', {})
            messages = state.get('messages', [])
            if state.get('status_str') == 'error' or any(m[0] in ('execution_error', 'execution_interrupted') for m in messages):
                failures = [m for m in messages if m[0] in ('execution_error', 'execution_interrupted')]
                detail = json.dumps(failures or state, ensure_ascii=False)[:2500]
                vram = 'Недостаточно видеопамяти. Закройте другие GPU-задачи и повторите кандидата. ' if any(
                    text in detail.lower() for text in ('out of memory', 'outofmemory', 'cuda error: memory')) else ''
                job.update(status='failed', error=vram + detail)
                persist()
                raise ComfyError(job['error'])
            if state.get('completed') and state.get('status_str') == 'success':
                _, _, _, outputs = bindings(graph)
                images = [image for key, value in record.get('outputs', {}).items() if key in outputs
                          for image in value.get('images', []) if image.get('type') == 'output']
                if len(images) != 1:
                    job.update(status='failed', error=f'Ожидалось одно выходное изображение SaveImage, получено {len(images)}.')
                    persist()
                    raise ComfyError(job['error'])
                image = images[0]
                params = {key: image[key] for key in ('filename', 'subfolder', 'type')}
                png = api.request('/view?' + urlencode(params), raw=True)
                if not png.startswith(b'\x89PNG\r\n\x1a\n'):
                    raise ComfyError('ComfyUI вернул файл, отличный от PNG.')
                atomic_write(folder / 'original.png', png)
                job.update(status='ready', review='unreviewed', output=params)
                persist()
                return
        elif not queue_count(api.request('/queue')):
            empty_polls += 1
            if empty_polls >= 4:
                job.update(status='failed', error=f'ComfyUI не находит {prompt_id} в истории и очередь пуста. Используйте retry.')
                persist()
                raise ComfyError(job['error'])
        else:
            empty_polls = 0
        time.sleep(2)
    raise ComfyError(f'Таймаут задания {prompt_id}. Оно сохранено как submitted; resume проверит его историю.')


def varied_jobs(config, count, state=None, seed=None):
    history = []
    if state:
        batches = sorted((state / 'batches').glob('*/batch.json'), key=lambda path: path.stat().st_mtime, reverse=True)
        for path in batches[:6]:
            for ident in read_json(path)['jobs'][:120 - len(history)]:
                candidate = state / 'candidates' / ident / 'candidate.json'
                if candidate.is_file():
                    history.append(read_json(candidate))
            if len(history) >= 120:
                break
    return plan_jobs(config, count, history, seed)


def copy_candidate(old):
    keys = ('title', 'positive', 'negative', 'technique', 'themes', 'moods', 'composition', 'palette', 'directions',
            'reference_direction', 'direction_label', 'complexity', 'palette_name', 'motif_key', 'medium_family',
            'topic', 'visual_intent', 'framing', 'technique_id', 'palette_prompted')
    return dict({key: old[key] for key in keys if key in old}, id=token(), status='pending', prompt_id=None,
                seed=random.randrange(2**48), retry_of=old['id'])


def plan_report(jobs):
    lines = [f'# Тестовый план · {len(jobs)} изображений', '', '| Направление | Количество |', '| --- | ---: |']
    for key, (label, _) in DIRECTIONS.items():
        lines.append(f"| {label} | {sum(job['reference_direction'] == key for job in jobs)} |")
    for index, job in enumerate(jobs, 1):
        lines += ['', f"## {index}. {job['title']}", '',
                  f"{job['direction_label']} · {job['technique']} · {job['complexity']} · seed {job['seed']}", '',
                  f"**Визуальная задумка** — {job['visual_intent']}", '',
                  job['positive'], '', f"**Negative prompt** — {job['negative']}"]
    return '\n'.join(lines) + '\n'


def safe_id(value):
    if not value or len(value) != 32 or any(char not in '0123456789abcdef' for char in value):
        raise ValueError('Укажите ID из 32 строчных шестнадцатеричных символов.')
    return value


@contextmanager
def runner_lock(port):
    path = Path(tempfile.gettempdir()) / f'polya-comfyui-{port}.lock'
    with path.open('a+b') as lock:
        lock.seek(0, os.SEEK_END)
        if not lock.tell():
            lock.write(b'0')
            lock.flush()
        lock.seek(0)
        try:
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError as error:
            raise ComfyError('На этом порту уже работает другой процесс генерации «Полей».') from error
        try:
            yield
        finally:
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)


def create_batch(args, graph, jobs, mode):
    bindings(graph)
    batch_id = token()
    folder = args.state / 'batches' / batch_id
    ids = []
    jobs = list(jobs)
    for job in jobs:
        job['batch_id'] = batch_id
        job['mode'] = mode
        ids.append(job['id'])
        save_json(args.state / 'candidates' / job['id'] / 'candidate.json', job)
    save_json(folder / 'workflow.json', graph)
    save_json(folder / 'plan.json', jobs)
    save_json(folder / 'batch.json', {'id': batch_id, 'port': args.port, 'jobs': ids,
                                     'created': datetime.now(timezone.utc).isoformat()})
    return batch_id


def execute_batch(args, batch_id, clear_stop=True):
    folder = args.state / 'batches' / safe_id(batch_id)
    batch = read_json(folder / 'batch.json')
    graph = read_json(folder / 'workflow.json')
    api = Comfy(batch['port'])
    stop = folder / 'stop'
    with runner_lock(batch['port']):
        if clear_stop:
            stop.unlink(missing_ok=True)
        api.check()
        print(f'Партия {batch_id}. Для остановки: stop {batch_id}', flush=True)
        for index, ident in enumerate(batch['jobs'], 1):
            if stop.exists():
                print('Партия остановлена. Используйте resume с тем же ID.', flush=True)
                return
            candidate = args.state / 'candidates' / ident
            file = candidate / 'candidate.json'
            job = read_json(file)
            print(f"[{index}/{len(batch['jobs'])}] {job['status']} · {ident}", flush=True)
            if job['status'] not in ('ready', 'failed'):
                run_candidate(api, graph, job, candidate, lambda: save_json(file, job), args.timeout)
            if job['status'] == 'ready':
                print(f'  Кандидат: {candidate}', flush=True)
        print('Партия обработана. Для просмотра используйте review.', flush=True)


def run_command(args):
    if args.command == 'plan':
        report = plan_report(varied_jobs(read_json(args.prompts), args.count, args.state, args.plan_seed))
        if args.plan_output:
            atomic_write(args.plan_output, report.encode())
        else:
            print(report, end='')
        return
    if args.command in ('review', 'workshop'):
        from review import serve
        return serve(args.state, args.review_port, args.port, args.workflow, args.prompts, args.timeout,
                     launch=args.command == 'workshop')
    if args.command == 'resume':
        return execute_batch(args, args.id)
    if args.command == 'stop':
        folder = args.state / 'batches' / safe_id(args.id)
        if not (folder / 'batch.json').exists():
            raise ValueError('Партия не найдена.')
        atomic_write(folder / 'stop', b'')
        print('Остановка после текущего изображения запрошена.')
        return
    if args.command == 'retry':
        old = read_json(args.state / 'candidates' / safe_id(args.id) / 'candidate.json')
        if old['status'] not in ('failed', 'ready'):
            raise ValueError('Кандидат ещё не завершён. Возобновите исходную партию через resume.')
        original_batch = args.state / 'batches' / old['batch_id'] if old.get('batch_id') else None
        graph = read_json(original_batch / 'workflow.json' if original_batch else args.workflow)
        if original_batch:
            args.port = read_json(original_batch / 'batch.json')['port']
        job = copy_candidate(old)
        return execute_batch(args, create_batch(args, graph, [job], 'retry'))
    graph = read_json(args.workflow)
    if args.command == 'smoke':
        return execute_batch(args, create_batch(args, graph, [smoke_job()], 'smoke'))
    if not any((job := read_json(path)).get('mode') == 'smoke' and job['status'] == 'ready'
               for path in (args.state / 'candidates').glob('*/candidate.json')):
        raise ValueError('Сначала успешно выполните smoke в том же каталоге состояния.')
    return execute_batch(args, create_batch(args, graph, varied_jobs(read_json(args.prompts), args.count, args.state), 'batch'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8188)
    parser.add_argument('--state', type=Path, default=DEFAULT_STATE)
    parser.add_argument('--workflow', type=Path, default=HERE / 'sdxl_api.json')
    parser.add_argument('--timeout', type=int, default=900)
    parser.add_argument('--review-port', type=int, default=8790)
    parser.add_argument('--count', type=int, default=10)
    parser.add_argument('--prompts', type=Path, default=HERE / 'prompts.json')
    parser.add_argument('--plan-seed', type=int)
    parser.add_argument('--plan-output', type=Path)
    parser.add_argument('command', nargs='?', default='workshop', choices=['workshop', 'check', 'smoke', 'plan', 'batch', 'resume', 'stop', 'retry', 'review'])
    parser.add_argument('id', nargs='?')
    args = parser.parse_args()
    if not 1 <= args.port <= 65535 or not 1 <= args.review_port <= 65535 or args.timeout <= 0 or not 1 <= args.count <= 1000:
        parser.error('Проверьте порты, положительный таймаут и число изображений от 1 до 1000.')
    if args.command in ('resume', 'stop', 'retry') and not args.id:
        parser.error(f'{args.command} требует ID.')
    if args.state.resolve().is_relative_to(ROOT):
        parser.error('Каталог состояния должен находиться вне проекта, чтобы исходные PNG не попали на сайт.')
    if args.command == 'check':
        Comfy(args.port).check()
        if args.workflow.is_file():
            positive, negative, seeds, outputs = bindings(read_json(args.workflow))
            print('Workflow API:', args.workflow, '·', len(positive), len(negative), len(seeds), len(outputs))
        else:
            print('Workflow отсутствует. Экспортируйте рабочий граф через Save (API Format).')
    else:
        run_command(args)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        sys.exit('\nОстановлено. Задание ComfyUI продолжает выполняться; используйте resume.')
    except (OSError, ValueError, KeyError, ComfyError) as error:
        sys.exit(str(error))
