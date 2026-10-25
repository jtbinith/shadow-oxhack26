import json, base64, pathlib, httpx
env = dict(l.split('=', 1) for l in pathlib.Path('../.env').read_text().splitlines() if '=' in l and not l.startswith('#'))
key, voice = env['ELEVENLABS_API_KEY'].strip(), env['ELEVENLABS_VOICE_ID_CALM'].strip()
text = dict(json.load(open('demo_vo.json')))['crows']
r = httpx.post(f'https://api.elevenlabs.io/v1/text-to-speech/{voice}/with-timestamps?output_format=mp3_44100_128',
               headers={'xi-api-key': key}, timeout=120,
               json={'text': text, 'model_id': 'eleven_v4', 'voice_settings': {'stability': 0.5, 'similarity_boost': 0.8, 'style': 0.3, 'use_speaker_boost': True}})
r.raise_for_status(); j = r.json()
pathlib.Path('public/demo-vo/crows.mp3').write_bytes(base64.b64decode(j['audio_base64']))
a = j['alignment']; chars = ''.join(a['characters']); starts = a['character_start_times_seconds']
marks = {}
for k, phrase in [('crow1', 'Just a crow'), ('crow2', 'An attempted'), ('crow3', 'is a murder'), ('fix', 'Shadow stops')]:
    i = chars.find(phrase); marks[k] = round(starts[i], 2)
print(marks)
pathlib.Path('src/crows_marks.json').write_text(json.dumps(marks))
