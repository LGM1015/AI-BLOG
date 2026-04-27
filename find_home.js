const fs = require('fs');
const c = fs.readFileSync('E:/lk02/server.js', 'utf8');
const lines = c.split('\n');
// Find home route
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('app.get("/"') && lines[i + 1] && lines[i + 1].includes('res.send')) {
        console.log('Home at line:', i + 1);
        for (let j = i; j < i + 60 && j < lines.length; j++) console.log(j + 1 + ':|' + lines[j] + '|');
        break;
    }
}
