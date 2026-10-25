"""Narration: one ElevenLabs line per scene (the coach's calm voice), then durations for Remotion."""
import json, subprocess, sys, pathlib, httpx
env = dict(l.split('=', 1) for l in pathlib.Path('../.env').read_text().splitlines() if '=' in l and not l.startswith('#'))
key, voice = env['ELEVENLABS_API_KEY'].strip(), env['ELEVENLABS_VOICE_ID_CALM'].strip()
out = {}
for name, text in json.load(open('vo.json')):
    f = pathlib.Path(f'public/vo/{name}.mp3')
    if not f.exists() or '--force' in sys.argv:
        r = httpx.post(f'https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_128',
                       headers={'xi-api-key': key}, timeout=120,
                       json={'text': text, 'model_id': 'eleven_v4',
                             'voice_settings': {'stability': 0.5, 'similarity_boost': 0.8, 'style': 0.3, 'use_speaker_boost': True}})
        r.raise_for_status()
        f.write_bytes(r.content)
    d = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(f)]))
    out[name] = round(d, 2)
    print(name, out[name])
pathlib.Path('src/durations.json').write_text(json.dumps(out, indent=1))
