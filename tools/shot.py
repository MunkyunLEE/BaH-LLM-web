import asyncio
import json
import sys

from playwright.async_api import async_playwright

URL = "http://localhost:8766/index.html"


async def main(example, out, steps):
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        pg = await b.new_page(viewport={"width": 1600, "height": 950})
        logs = []
        pg.on("console", lambda m: logs.append(f"{m.type}: {m.text}"))
        pg.on("pageerror", lambda e: logs.append(f"PAGEERROR: {e}"))
        await pg.goto(URL)
        await pg.wait_for_timeout(1500)
        if example:
            await pg.select_option("#example", example)
            await pg.click("#loadPreset")
            await pg.wait_for_timeout(1500)
        for st in steps:
            if st.startswith("chat:"):
                await pg.fill("#chatInput", st[5:])
                await pg.press("#chatInput", "Enter")
                await pg.wait_for_timeout(1500)
            elif st == "solve":
                await pg.click("#solve")
                for _ in range(600):
                    await pg.wait_for_timeout(500)
                    t = await pg.inner_text("#solve")
                    if t == "해석 실행":
                        break
                await pg.wait_for_timeout(1500)
            elif st.startswith("frame:"):
                v = st[6:]
                await pg.evaluate(f"(()=>{{const f=document.getElementById('frame'); f.value = {v} < 0 ? f.max : {v}; f.dispatchEvent(new Event('input'));}})()")
                await pg.wait_for_timeout(800)
            elif st.startswith("click:"):
                await pg.click(st[6:])
                await pg.wait_for_timeout(800)
            elif st.startswith("wait:"):
                await pg.wait_for_timeout(int(st[5:]))
            elif st.startswith("eval:"):
                await pg.evaluate(st[5:])
                await pg.wait_for_timeout(500)
        await pg.screenshot(path=out, full_page=False)
        info = await pg.evaluate("(()=>({msg: document.getElementById('solveMsg').innerText, summary: document.getElementById('summary').innerText.slice(0,400), chat: [...document.querySelectorAll('#chatLog .msg')].map(m=>m.innerText).slice(-4), plots: [...document.querySelectorAll('.plot .ptitle')].map(p=>p.innerText)}))()")
        print(json.dumps(info, ensure_ascii=False))
        for l in logs:
            if "error" in l.lower() or "PAGEERROR" in l:
                print(l)
        await b.close()


asyncio.run(main(sys.argv[1], sys.argv[2], sys.argv[3:]))
