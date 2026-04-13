const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) { console.error(err); return; }
    console.log('DB connected:', dbPath);
});

db.serialize(() => {
    db.run('ALTER TABLE news ADD COLUMN thumbnail_url TEXT DEFAULT ""', (err) => {
        if (err) console.log('[thumbnail_url]', err.message);
        else console.log('OK: thumbnail_url column added');
    });
    db.run('ALTER TABLE news ADD COLUMN file_url TEXT DEFAULT ""', (err) => {
        if (err) console.log('[file_url]', err.message);
        else console.log('OK: file_url column added');
        db.close(() => { console.log('Migration complete.'); });
    });
});
