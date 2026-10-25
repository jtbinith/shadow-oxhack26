"""Records real app footage for the pitch video: a headless Chrome signed in as the owner (session copied
from the dev browser, never committed), filmed with the DevTools screencast (sharp JPEG frames), then
turned into constant-frame-rate MP4 clips with ffmpeg.

  python rec.py <clip> [...]     clips: home upload plan progress

Live practice (camera) footage is a real screen recording, never a video fed in as the camera.
"""
import asyncio, base64, os, shutil, subprocess, sys, time
from playwright.async_api import async_playwright

STATE = os.path.expanduser('~/.playwright-mcp/shadow-state.json')
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'clips')
APP = 'http://127.0.0.1:5173'
W, H = 1920, 1080


class Film:
    """Collects screencast frames (with their timestamps) and writes a 30 fps MP4."""
    def __init__(self, page, name):
        self.page, self.name, self.frames = page, name, []

    async def __aenter__(self):
        self.cdp = await self.page.context.new_cdp_session(self.page)
        async def on_frame(e):
            self.frames.append((e['metadata']['timestamp'], base64.b64decode(e['data'])))
            try:
                await self.cdp.send('Page.screencastFrameAck', {'sessionId': e['sessionId']})
            except Exception:
                pass  # the page closed mid-frame
        self.cdp.on('Page.screencastFrame', lambda e: asyncio.ensure_future(on_frame(e)))
        await self.cdp.send('Page.startScreencast', {'format': 'jpeg', 'quality': 88, 'maxWidth': W, 'maxHeight': H, 'everyNthFrame': 1})
        self.t0 = time.time()
        return self

    async def __aexit__(self, *a):
        await self.cdp.send('Page.stopScreencast')
        end = time.time()
        d = f'/tmp/frames-{self.name}'
        shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
        lines = []
        fr = sorted(self.frames)
        for i, (ts, jpg) in enumerate(fr):
            p = f'{d}/{i:05d}.jpg'
            open(p, 'wb').write(jpg)
            nxt = fr[i + 1][0] if i + 1 < len(fr) else end
            lines += [f"file '{p}'", f'duration {max(0.001, nxt - ts):.4f}']
        lines.append(f"file '{d}/{len(fr) - 1:05d}.jpg'")
        open(f'{d}/list.txt', 'w').write('\n'.join(lines))
        os.makedirs(OUT, exist_ok=True)
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', f'{d}/list.txt',
                        '-vf', f'fps=30,scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2',
                        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', f'{OUT}/{self.name}.mp4'], check=True)
        print(f'{self.name}: {len(fr)} frames, {end - self.t0:.1f} s')


async def smooth_scroll(page, to, ms=1500):
    await page.evaluate("""([to, ms]) => new Promise(r => { const s = scrollY, t0 = performance.now();
      const step = (n) => { const k = Math.min(1, (n - t0) / ms), e = k < .5 ? 2*k*k : 1 - Math.pow(-2*k + 2, 2) / 2;
        scrollTo(0, s + (to - s) * e); k < 1 ? requestAnimationFrame(step) : r() }; requestAnimationFrame(step) })""", [to, ms])


async def camera_ready(page):
    # The pose models download on first use (slow on venue Wi-Fi); wait until the camera is live.
    await page.wait_for_function("() => { const s = document.querySelector('.stage'); return s && !s.innerText.includes('Starting camera') && !s.innerText.includes('Loading') }", timeout=240000)
    await page.wait_for_timeout(2500)


async def open_routine(page, title):
    await page.goto(APP + '/')
    await page.get_by_text(title, exact=True).first.click()
    await page.get_by_text('Flow the whole routine').wait_for()


async def clip(name, cam=None):
    async with async_playwright() as p:
        args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required']
        if cam:
            args.append(f'--use-file-for-fake-video-capture={cam}')
        b = await p.chromium.launch(channel='chromium', headless=False, args=args + ['--window-position=0,0', '--window-size=1920,1160'])
        ctx = await b.new_context(storage_state=STATE, viewport={'width': W, 'height': H}, permissions=['camera', 'microphone'])
        # Full screen can't be filmed headless: keep the normal layout.
        await ctx.add_init_script("Element.prototype.requestFullscreen = function () { return Promise.resolve() }")
        page = await ctx.new_page()
        await page.goto(APP + '/')
        await page.get_by_role('heading', name='Your routines').wait_for()
        await page.locator('.routine-progress, .home li').first.wait_for(timeout=30000)
        await page.wait_for_timeout(800)
        await SCENES[name](page)
        await b.close()


# ---- the scenes ----------------------------------------------------------------------------
async def home(page):
    async with Film(page, 'home'):
        await page.wait_for_timeout(3500)
        await smooth_scroll(page, 520, 1800)
        await page.wait_for_timeout(1800)
        await smooth_scroll(page, 0, 1200)
        await page.wait_for_timeout(800)


async def upload(page):
    await smooth_scroll(page, 380, 10)
    async with Film(page, 'upload'):
        await page.wait_for_timeout(700)
        await page.locator('.upload input[type=file]').set_input_files(os.path.expanduser('~/Downloads/IMG_6047.mov'))
        name = page.get_by_placeholder('Routine name')
        await name.fill('')
        await name.press_sequentially('Demo Groove', delay=70)
        await page.wait_for_timeout(300)
        await page.locator('.upload input[type=checkbox]').check()
        await page.wait_for_timeout(500)
        await page.get_by_text('Build my course').click()
        await page.get_by_text('Flow the whole routine').wait_for(timeout=120000)
        await page.wait_for_timeout(2500)


async def plan(page):
    await open_routine(page, ROUTINE)
    await page.wait_for_timeout(1500)
    async with Film(page, 'plan'):
        await page.wait_for_timeout(2500)
        await page.locator('.section-head button').first.hover()
        await page.wait_for_timeout(3000)
        await page.mouse.move(10, 10)
        box = page.get_by_placeholder('Tell the coach', exact=False)
        await box.click()
        await box.press_sequentially('I have two weeks before my show', delay=45)
        await page.wait_for_timeout(1500)


async def practice(page):
    await open_routine(page, ROUTINE)
    await page.get_by_text('Flow the whole routine').click()
    await page.get_by_text('Start flowing', exact=False).wait_for(timeout=60000)
    await camera_ready(page)
    async with Film(page, 'practice'):
        await page.wait_for_timeout(1500)
        await page.get_by_text('Start flowing', exact=False).click()
        await page.wait_for_timeout(14000)


async def murder(page):
    await practice_mistake(page, 'murder')


async def practice_mistake(page, name):
    await open_routine(page, ROUTINE)
    await page.get_by_text('Flow the whole routine').click()
    await page.get_by_text('Start flowing', exact=False).wait_for(timeout=60000)
    await camera_ready(page)
    async with Film(page, name):
        await page.wait_for_timeout(800)
        await page.get_by_text('Start flowing', exact=False).click()
        await page.locator('.mistake').wait_for(timeout=40000)
        await page.wait_for_timeout(5000)
        await smooth_scroll(page, 600, 1500)
        await page.wait_for_timeout(2500)


async def ask(page):
    await open_routine(page, ROUTINE)
    await page.get_by_text('Flow the whole routine').click()
    await page.get_by_text('Start flowing', exact=False).wait_for(timeout=60000)
    await camera_ready(page)
    async with Film(page, 'ask'):
        await page.wait_for_timeout(800)
        box = page.get_by_placeholder('Ask the coach', exact=False)
        await box.click()
        await box.press_sequentially('how do I fix my arms on count 3?', delay=45)
        await box.press('Enter')
        await page.locator('.askpanel .coach-says').wait_for(timeout=60000)
        await page.wait_for_timeout(6000)


async def progress(page):
    async with Film(page, 'progress'):
        await page.get_by_text('My progress').first.click()
        await page.get_by_text('Habits across your routines').wait_for(timeout=30000)
        await page.wait_for_timeout(2500)
        await smooth_scroll(page, 700, 2200)
        await page.wait_for_timeout(2500)
        await smooth_scroll(page, 1400, 1800)
        await page.wait_for_timeout(1500)


SCENES = dict(home=home, upload=upload, plan=plan, progress=progress)
ROUTINE = "Aaditya's Quick 4-Count"
CAMS: dict[str, str] = {}  # never feed a video into the camera: live scenes come from real screen recordings

if __name__ == '__main__':
    for n in sys.argv[1:]:
        asyncio.run(clip(n, CAMS.get(n)))
