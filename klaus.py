# Python / klaus.py / Python 3 + Node.js 24 / Termux Linux, Klaus-bots
"""Entrada única. O kernel libera o lock inclusive após SIGKILL."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import shutil
import sys

REPO = Path(__file__).resolve().parent


def manifests():
    result = {}
    for p in sorted((REPO / 'bots').glob('*/manifest.json')):
        value = json.loads(p.read_text('utf-8'))
        if value.get('id') != p.parent.name:
            raise RuntimeError('Identidade incompatível no manifesto: ' + str(p))
        result[value['id']] = value
    return result


def main():
    available = manifests()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['sites', 'status', 'importar', 'diagnostico'])
    parser.add_argument('bot', nargs='?', choices=sorted(available))
    parser.add_argument('batch', nargs='?', type=Path)
    args = parser.parse_args()
    if args.command == 'sites':
        for item in available.values():
            print(f"{item['id']} | {item['title']} | {item['stage']}")
        return
    if not args.bot:
        parser.error('Informe o bot.')
    if args.command == 'diagnostico':
        if args.batch:
            parser.error('O diagnóstico não recebe um lote.')
        script = REPO / 'bots' / args.bot / available[args.bot]['diagnostic']
        if script.parent != REPO / 'bots' / args.bot or not script.is_file():
            raise RuntimeError('Coletor inválido no manifesto.')
        os.execv(sys.executable, [sys.executable, str(script)])
    if not shutil.which('node'):
        raise RuntimeError('Node.js não encontrado.')
    data = Path(os.environ.get('KLAUS_DATA_DIR', str(Path.home() / '.local/share/klaus-bots'))).resolve()
    if data.is_relative_to(REPO):
        raise RuntimeError('Os dados locais devem ficar fora do repositório.')
    if args.command == 'importar' and not args.batch:
        parser.error('Informe o arquivo JSON do lote.')
    if args.command != 'importar' and args.batch:
        parser.error('Este comando não recebe um arquivo de lote.')
    folder = data / args.bot
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock_path = folder / 'operation.lock'
    fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(fd)
        raise RuntimeError('Outra operação deste bot possui o lock. Isso não confirma uma geração no site.')
    os.set_inheritable(fd, True)
    os.environ['KLAUS_LOCK_FD'] = str(fd)
    os.environ['KLAUS_DATA_DIR'] = str(data)
    command = 'import' if args.command == 'importar' else args.command
    argv = ['node', str(REPO / 'core/cli.cjs'), command, args.bot]
    if args.batch:
        argv.append(str(args.batch.resolve()))
    # The same open file description and kernel lock survive exec into Node.
    os.execvpe('node', argv, os.environ)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, ValueError) as error:
        print('KLAUS: ' + str(error), file=sys.stderr)
        sys.exit(1)
