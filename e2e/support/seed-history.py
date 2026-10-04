"""Writes synthetic rows straight into a CLOSED Chromium profile's History database (history.addUrl cannot set visit times or titles).
Usage: seed-history.py <profile-dir> <bulk-rows> <ancient-rows>
bulk rows: https://<n>.bulk.example/p/<i>, 1..89 days old; ancient rows: https://ancient-<i>.example/page, 100 days old (Chrome expires them itself)."""
import sqlite3, sys, random, time

profile, bulk, ancient = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
rnd = random.Random(7)
c = sqlite3.connect(f'{profile}/Default/History')
epoch = lambda ms: int((ms + 11644473600000) * 1000)
now = int(time.time() * 1000)
day = 86_400_000
next_id = 1000
for i in range(bulk):
    t = epoch(now - int((1 + rnd.random() * 88) * day))
    cur = c.execute("insert into urls(id,url,title,visit_count,typed_count,last_visit_time,hidden) values(?,?,?,?,?,?,0)", (next_id, f'https://{i % 400}.bulk.example/p/{i}', f'Bulk page {i} topic{i % 50}', 1 + i % 5, 0, t))
    c.execute("insert into visits(url,visit_time,from_visit,transition,visit_duration) values(?,?,0,805306369,0)", (next_id, t))
    next_id += 1
for i in range(ancient):
    t = epoch(now - 100 * day - i * 1000)
    c.execute("insert into urls(id,url,title,visit_count,typed_count,last_visit_time,hidden) values(?,?,?,?,?,?,0)", (next_id, f'https://ancient-{i}.example/page', f'Ancient memory {i}', 1, 0, t))
    c.execute("insert into visits(url,visit_time,from_visit,transition,visit_duration) values(?,?,0,805306369,0)", (next_id, t))
    next_id += 1
c.commit()
print('seeded', c.execute('select count(*) from urls').fetchone()[0], 'urls')
