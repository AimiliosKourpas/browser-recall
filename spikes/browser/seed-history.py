"""Write N synthetic history rows spread over the last 89 days straight into a closed Chromium profile's History DB.
(history.addUrl cannot set visitTime or title in Chromium 141.)  Usage: seed-history.py <profile-dir> <N>"""
import sqlite3, sys, random, time
profile, n = sys.argv[1], int(sys.argv[2])
rnd = random.Random(1234)
syl = ['ba','ko','ri','su','ten','la','mor','vi','dex','qua','pro','nal','ist','er','on','cal','fu','gra','hy','jo']
words = [''.join(rnd.choice(syl) for _ in range(rnd.randint(1, 4))) for _ in range(5000)]
c = sqlite3.connect(f'{profile}/Default/History')
epoch = lambda ms: int((ms + 11644473600000) * 1000)
now = int(time.time() * 1000)
urls, visits = [], []
for i in range(n):
    t = epoch(now - rnd.randint(60_000, 89 * 86_400_000))
    d = rnd.randint(0, 4999)
    title = ' '.join(rnd.choice(words) for _ in range(rnd.randint(3, 8)))
    vc = 1 + int(rnd.random() ** 3 * 20)
    urls.append((i + 100, f'https://{words[d]}{d}.example/{words[rnd.randint(0, 4999)]}/{i}', title, vc, 0, t, 0))
    visits.append((i + 100, i + 100, t, 0, 805306369, 0))
c.executemany('insert into urls(id,url,title,visit_count,typed_count,last_visit_time,hidden) values(?,?,?,?,?,?,?)', urls)
c.executemany('insert into visits(id,url,visit_time,from_visit,transition,visit_duration) values(?,?,?,?,?,?)', visits)
c.commit()
print('seeded', c.execute('select count(*) from urls').fetchone()[0], 'urls')
