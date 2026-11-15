const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = 80;
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Create uploads directory if not exists
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Helper to parse cookies
function parseCookies(req) {
    const list = {};
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
        cookieHeader.split(';').forEach((cookie) => {
            const parts = cookie.split('=');
            list[parts.shift().trim()] = decodeURI(parts.join('='));
        });
    }
    return list;
}

// Multipart parser for vanilla Node.js
function parseMultipart(req, callback) {
    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.includes('boundary=')) {
        callback(new Error('Missing boundary header'));
        return;
    }

    const boundary = '--' + contentType.split('boundary=')[1];
    let body = Buffer.alloc(0);

    req.on('data', (chunk) => {
        body = Buffer.concat([body, chunk]);
    });

    req.on('end', () => {
        try {
            const boundaryIndex = body.indexOf(boundary);
            if (boundaryIndex === -1) {
                callback(new Error('Boundary not found in body'));
                return;
            }

            // Find start of file data
            const dispositionIndex = body.indexOf('Content-Disposition:');
            if (dispositionIndex === -1) {
                callback(new Error('Content-Disposition not found'));
                return;
            }

            const headerEndIndex = body.indexOf('\r\n\r\n', dispositionIndex);
            if (headerEndIndex === -1) {
                callback(new Error('Headers end boundary not found'));
                return;
            }

            const headerBlock = body.slice(dispositionIndex, headerEndIndex).toString();
            
            // Extract filename
            const filenameMatch = headerBlock.match(/filename="([^"]+)"/);
            const filename = filenameMatch ? filenameMatch[1] : 'uploaded_file';

            // Extract Content-Type
            const typeMatch = headerBlock.match(/Content-Type:\s*([^\r\n]+)/);
            const fileContentType = typeMatch ? typeMatch[1].trim() : 'application/octet-stream';

            // Extract body contents
            const fileDataStart = headerEndIndex + 4;
            const fileDataEnd = body.indexOf('\r\n' + boundary, fileDataStart);
            if (fileDataEnd === -1) {
                callback(new Error('Ending boundary not found'));
                return;
            }

            const fileBuffer = body.slice(fileDataStart, fileDataEnd);
            callback(null, { filename, contentType: fileContentType, buffer: fileBuffer });
        } catch (err) {
            callback(err);
        }
    });
}

// Main Web Server
const server = http.createServer((req, res) => {
    const cookies = parseCookies(req);
    const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = parsedUrl.pathname;

    // Serve Favicon using base64 PNG wrapped in ICO format and disable caching
    if (pathname === '/favicon.ico') {
        const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAMAAAAoLQ9TAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAwUExURf9AAAC/50wAAQAAAD1yS/UAAAAJcEhZcwAACxMAAAsTAQCanBgAAAAYSURBVHjaYmBgYGBkYEAFAzMMAAAQAA//AKoAC59942MAAAAASUVORK5CYII=';
        const pngBuffer = Buffer.from(pngBase64, 'base64');
        
        // Construct a standard ICO wrapper containing the PNG
        const icoHeader = Buffer.alloc(22);
        icoHeader.writeUInt16LE(0, 0);     // Reserved
        icoHeader.writeUInt16LE(1, 2);     // Type (1 = ICO)
        icoHeader.writeUInt16LE(1, 4);     // Count (1 image)
        icoHeader.writeUInt8(16, 6);       // Width (16)
        icoHeader.writeUInt8(16, 7);       // Height (16)
        icoHeader.writeUInt8(0, 8);        // Color count (0)
        icoHeader.writeUInt8(0, 9);        // Reserved (0)
        icoHeader.writeUInt16LE(1, 10);    // Planes (1)
        icoHeader.writeUInt16LE(32, 12);   // Bits per pixel (32)
        icoHeader.writeUInt32LE(pngBuffer.length, 14); // Image size
        icoHeader.writeUInt32LE(22, 18);   // Image offset (22)
        
        const icoBuffer = Buffer.concat([icoHeader, pngBuffer]);
        res.writeHead(200, {
            'Content-Type': 'image/x-icon',
            'Content-Length': icoBuffer.length,
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
        });
        res.end(icoBuffer);
        return;
    }

    // 1. Static plain text assets
    if (pathname === '/dev/notes.txt') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Hey James, I temporarily enabled admin login bypass for debugging. Use the backup bypass string. Remember to disable before shipping.');
        return;
    }

    if (pathname === '/robots.txt') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end("User-agent: *\nDisallow: /admin\nDisallow: /dev\nDisallow: /uploads\nDisallow: /backup");
        return;
    }

    if (pathname === '/config.php.bak' || pathname === '/backup/config.php.bak' || pathname === '/config.bak' || pathname === '/backup/config.bak') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end("<?php\n// Backup of old database settings\ndefine('DB_HOST', 'localhost');\ndefine('DB_USER', 'james');\ndefine('DB_PASS', 'JamesPassword2026!');\ndefine('DB_NAME', 'axinor_db');\n?>");
        return;
    }

    if (pathname === '/.env') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end("DB_CONNECTION=mysql\nDB_HOST=127.0.0.1\nDB_PORT=3306\nDB_DATABASE=axinor_db\nDB_USERNAME=james\nDB_PASSWORD=JamesPassword2026!");
        return;
    }

    // 2. Homepage (vulnerable to XSS and LFI via parameters)
    if (pathname === '/' || pathname === '/index.php') {
        const pageParam = parsedUrl.searchParams.get('page');
        if (pageParam) {
            // Simulated LFI Endpoint
            if (pageParam.includes('etc/passwd')) {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end("root:x:0:0:root:/root:/bin/bash\ndaemon:x:1:1:daemon:/usr/sbin:/usr/sbin/auth\nwww-data:x:33:33:www-data:/var/www:/usr/sbin/nologin\njames:x:1001:1001:James Developer:/home/james:/bin/bash");
                return;
            } else if (pageParam.includes('db.php') || pageParam.includes('var/www/html/db.php')) {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end("<?php\n$db_host = 'localhost';\n$db_user = 'james';\n$db_pass = 'JamesPassword2026!';\n$db_name = 'axinor_db';\n?>");
                return;
            } else {
                res.writeHead(200, { 
                    'Content-Type': 'text/html',
                    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
                });
                res.end(`<html><head><title>AXINOR - Diagnostics</title><link rel="shortcut icon" type="image/x-icon" href="/favicon.ico?v=3"><link rel="icon" type="image/x-icon" href="/favicon.ico?v=3"></head><body style="background:#0a0505; color:#a1a1aa; font-family:monospace; padding:20px;">
                <h3>Audit Log: ${pageParam}</h3>
                <p>Status: Active. Traversal validation checks loaded.</p>
                </body></html>`);
                return;
            }
        }

        // Standard Home Page Portal HTML
        res.writeHead(200, { 
            'Content-Type': 'text/html',
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
        });
        res.end(getPortalHTML());
        return;
    }

    // 3. API user profiles (vulnerable to IDOR)
    if (pathname === '/api/user') {
        const userId = parsedUrl.searchParams.get('id');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (userId === '1') {
            res.end(JSON.stringify({
                status: 'success',
                user: 'james',
                role: 'Lead Developer',
                home: '/home/james',
                secret_creds: 'JamesPassword2026!',
                notes: 'LFI debug mode parameter is enabled on index.php?page='
            }));
        } else if (userId === '3') {
            res.end(JSON.stringify({
                status: 'success',
                user: 'guest',
                role: 'Standard Auditor',
                home: '/home/guest',
                secret_creds: 'N/A',
                notes: 'Read-only profile context.'
            }));
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'error', message: 'User not found' }));
        }
        return;
    }

    // 4. Admin Portal Login
    if (pathname === '/admin') {
        res.writeHead(200, { 
            'Content-Type': 'text/html',
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
        });
        res.end(getAdminLoginHTML());
        return;
    }

    // Process SQLi Login Form
    if (pathname === '/admin/login' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            const params = new URLSearchParams(body);
            const user = params.get('username') || '';
            const pass = params.get('password') || '';

            // Vulnerable SQLi authentication check
            if (user === 'james' && (pass === "' OR 1=1 -- -" || pass.includes("' OR '1'='1") || pass === "' OR 1=1")) {
                res.writeHead(302, {
                    'Set-Cookie': 'session=admin_active; Path=/; HttpOnly',
                    'Location': '/admin/dashboard'
                });
                res.end();
            } else {
                res.writeHead(200, { 
                    'Content-Type': 'text/html',
                    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
                });
                res.end(getAdminLoginHTML("Invalid username or password database match. SQLi payload required."));
            }
        });
        return;
    }

    // 5. Admin Dashboard (Vulnerable panel)
    if (pathname === '/admin/dashboard') {
        if (cookies.session !== 'admin_active') {
            res.writeHead(302, { 'Location': '/admin' });
            res.end();
            return;
        }
        res.writeHead(200, { 
            'Content-Type': 'text/html',
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
        });
        res.end(getAdminDashboardHTML());
        return;
    }

    // File Upload Handler (Vulnerable)
    if (pathname === '/admin/upload' && req.method === 'POST') {
        if (cookies.session !== 'admin_active') {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('Access Denied');
            return;
        }

        parseMultipart(req, (err, file) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Upload parsing error: ' + err.message);
                return;
            }

            const { filename, contentType, buffer } = file;
            const ext = path.extname(filename).toLowerCase();

            // Vulnerable check: Blocks simple .php extension, but allows double extension and Content-Type spoofing
            if (ext === '.php' && contentType === 'application/x-php') {
                res.writeHead(403, { 
                    'Content-Type': 'text/html',
                    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
                });
                res.end(getAdminDashboardHTML("UPLOAD ERROR: File extension '.php' blocked by security filters. Only PDF documents allowed."));
                return;
            }

            // Save the uploaded file to disk
            const savePath = path.join(UPLOADS_DIR, filename);
            fs.writeFile(savePath, buffer, (writeErr) => {
                if (writeErr) {
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('Failed to save file: ' + writeErr.message);
                    return;
                }
                res.writeHead(200, { 
                    'Content-Type': 'text/html',
                    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
                });
                res.end(getAdminDashboardHTML(`File uploaded successfully to: /uploads/${filename}`));
            });
        });
        return;
    }

    // Ping Diagnostics Tool (Vulnerable to Command Injection)
    if (pathname === '/admin/ping' && req.method === 'POST') {
        if (cookies.session !== 'admin_active') {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('Access Denied');
            return;
        }

        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            const params = new URLSearchParams(body);
            const address = params.get('address') || '';

            if (!address) {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('Address required');
                return;
            }

            // VULNERABLE: Direct concatenation executing system commands!
            const cmd = `ping -c 1 ${address}`;
            exec(cmd, (execErr, stdout, stderr) => {
                res.writeHead(200, { 
                    'Content-Type': 'text/html',
                    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
                });
                const output = stdout || stderr || 'No ping response received.';
                res.end(getAdminDashboardHTML(null, output));
            });
        });
        return;
    }

    // Serving uploaded files (and executing command parameters if it has a PHP extension)
    if (pathname.startsWith('/uploads/')) {
        const filename = pathname.replace('/uploads/', '');
        const filePath = path.join(UPLOADS_DIR, filename);

        if (!fs.existsSync(filePath)) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Uploaded file not found.');
            return;
        }

        // If file ends in .php (e.g. bypassed files like shell.jpg.php), run the web shell command parameters
        if (filename.toLowerCase().endsWith('.php')) {
            const cmdParam = parsedUrl.searchParams.get('cmd');
            if (cmdParam) {
                // Execute command and return output (Remote Code Execution)
                exec(cmdParam, (execErr, stdout, stderr) => {
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.end(stdout || stderr || 'Command executed, no output.');
                });
                return;
            } else {
                // Trigger connection back to Netcat listener if triggered in background
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end("Web Shell Active. Use ?cmd=[command] to execute shell parameters (e.g. ?cmd=whoami).\n");
                return;
            }
        }

        // Serve static file normal way
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Error loading file');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
            res.end(data);
        });
        return;
    }

    // 6. Generic 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
});

// Start Server
server.listen(PORT, () => {
    console.log(`[AXINOR SIMULATOR] Vulnerable target portal is running at http://localhost:${PORT}`);
    console.log(`[AXINOR SIMULATOR] Press Ctrl+C to stop`);
});


// --- HTML PAGE VIEWS (Embedded locally for offline-first design) ---

function getPortalHTML() {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>AXINOR - Cyber Solutions Portal</title>
        <link rel="shortcut icon" type="image/x-icon" href="/favicon.ico?v=3">
        <link rel="icon" type="image/x-icon" href="/favicon.ico?v=3">
        <link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;700;900&family=Inter:wght@400;600&display=swap" rel="stylesheet">
        <style>
            :root {
                --bg: #070303;
                --primary: #ef4444;
                --text: #fee2e2;
                --card-bg: rgba(22, 11, 11, 0.7);
            }
            body {
                background-color: var(--bg);
                color: var(--text);
                font-family: 'Inter', sans-serif;
                margin: 0;
                padding: 40px 20px;
                display: flex;
                flex-direction: column;
                align-items: center;
                background-image: linear-gradient(rgba(239, 68, 68, 0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(239, 68, 68, 0.02) 1px, transparent 1px);
                background-size: 30px 30px;
            }
            .container {
                max-width: 600px;
                width: 100%;
                background: var(--card-bg);
                border: 1px solid rgba(239, 68, 68, 0.25);
                border-radius: 8px;
                padding: 24px;
                box-shadow: 0 0 25px rgba(239, 68, 68, 0.05);
            }
            h1, h2 {
                font-family: 'Chakra Petch', sans-serif;
                color: var(--primary);
                text-transform: uppercase;
                margin-top: 0;
            }
            p {
                font-size: 13px;
                color: #a1a1aa;
                line-height: 1.5;
            }
            .search-box {
                display: flex;
                gap: 8px;
                margin: 20px 0;
            }
            input[type="text"] {
                flex-grow: 1;
                background: #18181b;
                border: 1px solid rgba(255,255,255,0.08);
                color: white;
                padding: 8px 12px;
                border-radius: 4px;
                outline: none;
                font-family: monospace;
            }
            button {
                background: var(--primary);
                color: white;
                border: none;
                padding: 8px 16px;
                border-radius: 4px;
                cursor: pointer;
                font-weight: bold;
            }
            .grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 16px;
            }
            .card {
                background: rgba(255,255,255,0.02);
                border: 1px solid rgba(255,255,255,0.05);
                padding: 16px;
                border-radius: 6px;
            }
            .card h3 {
                color: #f87171;
                margin-top: 0;
                font-size: 14px;
            }
            .card a {
                display: inline-block;
                margin-top: 10px;
                color: var(--primary);
                text-decoration: none;
                font-size: 12px;
                font-weight: bold;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>AXINOR CYBER SOLUTIONS</h1>
            <p>Enterprise Network Protection & Software Auditing Services.</p>

            <form class="search-box" method="GET" action="/" onsubmit="handleSearch(event)">
                <input type="text" name="search" id="search-input" placeholder="Search portal resources..." required />
                <button type="submit">Search</button>
            </form>

            <div class="grid">
                <div class="card">
                    <h3>Administration Portal</h3>
                    <p>Access manager dashboard and control file logs.</p>
                    <a href="/admin">Access Login &rarr;</a>
                </div>
                <div class="card">
                    <h3>Diagnostic Services</h3>
                    <p>Verify internal server loops and page traversal configurations.</p>
                    <a href="/index.php?page=services.php">Run Diagnostics &rarr;</a>
                </div>
            </div>
        </div>

        <script>
            function handleSearch(e) {
                const val = document.getElementById('search-input').value;
                if (val.includes('<script>') || val.toLowerCase().includes('onerror=')) {
                    e.preventDefault();
                    // Exploit reflected XSS directly in browser
                    const script = val.match(/<script>(.*?)<\\/script>/i);
                    if (script && script[1]) {
                        eval(script[1]);
                    } else if (val.toLowerCase().includes('onerror=')) {
                        alert("Reflected XSS Vulnerability Triggered!");
                    }
                }
            }
        </script>
    </body>
    </html>`;
}

function getAdminLoginHTML(errorMsg = '') {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>AXINOR - Admin Login Portal</title>
        <link rel="shortcut icon" type="image/x-icon" href="/favicon.ico?v=3">
        <link rel="icon" type="image/x-icon" href="/favicon.ico?v=3">
        <link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;700;900&family=Inter:wght@400;600&display=swap" rel="stylesheet">
        <style>
            body {
                background: #070303;
                color: #fee2e2;
                font-family: 'Inter', sans-serif;
                margin: 0;
                padding: 40px 20px;
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 80vh;
                background-size: 30px 30px;
                background-image: linear-gradient(rgba(239, 68, 68, 0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(239, 68, 68, 0.02) 1px, transparent 1px);
            }
            .login-card {
                max-width: 360px;
                width: 100%;
                background: rgba(22, 11, 11, 0.7);
                border: 1px solid rgba(239, 68, 68, 0.25);
                border-radius: 8px;
                padding: 24px;
                box-shadow: 0 0 25px rgba(239, 68, 68, 0.05);
            }
            h2 {
                font-family: 'Chakra Petch', sans-serif;
                color: #ef4444;
                text-align: center;
                margin-top: 0;
            }
            .form-group {
                display: flex;
                flex-direction: column;
                gap: 6px;
                margin-bottom: 12px;
            }
            label {
                font-size: 11px;
                font-family: monospace;
                color: #fca5a5;
            }
            input {
                background: #120a0a;
                border: 1px solid rgba(255,255,255,0.08);
                color: white;
                padding: 8px;
                border-radius: 4px;
                outline: none;
                font-family: monospace;
            }
            button {
                background: #ef4444;
                color: white;
                border: none;
                padding: 10px;
                border-radius: 4px;
                cursor: pointer;
                font-weight: bold;
                font-family: monospace;
                width: 100%;
                margin-top: 10px;
            }
            .error {
                color: #f87171;
                font-size: 11px;
                margin-bottom: 12px;
                font-family: monospace;
                text-align: center;
            }
        </style>
    </head>
    <body>
        <div class="login-card">
            <h2>Admin Login Portal</h2>
            ${errorMsg ? `<div class="error">${errorMsg}</div>` : ''}
            <form method="POST" action="/admin/login">
                <div class="form-group">
                    <label>Username</label>
                    <input type="text" name="username" required />
                </div>
                <div class="form-group">
                    <label>Password</label>
                    <input type="password" name="password" required />
                </div>
                <button type="submit">Authenticate &rarr;</button>
            </form>
        </div>
    </body>
    </html>`;
}

function getAdminDashboardHTML(uploadMsg = '', pingResult = '') {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>AXINOR - Admin Dashboard</title>
        <link rel="shortcut icon" type="image/x-icon" href="/favicon.ico?v=3">
        <link rel="icon" type="image/x-icon" href="/favicon.ico?v=3">
        <link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;700;900&family=Inter:wght@400;600&display=swap" rel="stylesheet">
        <style>
            :root {
                --bg: #070303;
                --primary: #ef4444;
                --text: #fee2e2;
                --card-bg: rgba(22, 11, 11, 0.7);
            }
            body {
                background: var(--bg);
                color: var(--text);
                font-family: 'Inter', sans-serif;
                margin: 0;
                padding: 40px 20px;
                display: flex;
                flex-direction: column;
                align-items: center;
                background-size: 30px 30px;
                background-image: linear-gradient(rgba(239, 68, 68, 0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(239, 68, 68, 0.02) 1px, transparent 1px);
            }
            .container {
                max-width: 800px;
                width: 100%;
                background: var(--card-bg);
                border: 1px solid rgba(239, 68, 68, 0.25);
                border-radius: 8px;
                padding: 24px;
                box-shadow: 0 0 25px rgba(239, 68, 68, 0.05);
            }
            .header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid rgba(255,255,255,0.08);
                padding-bottom: 12px;
                margin-bottom: 20px;
            }
            h2, h3 {
                font-family: 'Chakra Petch', sans-serif;
                color: var(--primary);
                margin: 0;
            }
            .logout-btn {
                background: #27272a;
                color: #e4e4e7;
                border: none;
                padding: 4px 12px;
                border-radius: 4px;
                cursor: pointer;
                font-family: monospace;
                font-size: 11px;
            }
            .grid {
                display: grid;
                grid-template-columns: 1fr;
                gap: 20px;
                margin-bottom: 20px;
            }
            @media (min-width: 768px) {
                .grid { grid-template-columns: 1fr 1fr; }
            }
            .widget {
                background: rgba(255,255,255,0.02);
                border: 1px solid rgba(255,255,255,0.05);
                padding: 16px;
                border-radius: 6px;
                display: flex;
                flex-direction: column;
                gap: 12px;
            }
            .form-input {
                background: #120a0a;
                border: 1px solid rgba(255,255,255,0.08);
                color: white;
                padding: 8px;
                border-radius: 4px;
                outline: none;
                font-family: monospace;
                font-size: 12px;
            }
            .submit-btn {
                background: var(--primary);
                color: white;
                border: none;
                padding: 8px;
                border-radius: 4px;
                cursor: pointer;
                font-weight: bold;
                font-family: monospace;
            }
            .msg {
                font-family: monospace;
                font-size: 11px;
                padding: 8px;
                border-radius: 4px;
                background: rgba(255,255,255,0.04);
                margin-top: 4px;
            }
            pre {
                background: black;
                color: #22c55e;
                padding: 12px;
                border-radius: 4px;
                font-family: monospace;
                font-size: 11px;
                max-height: 200px;
                overflow-y: auto;
                line-height: 1.4;
                border: 1px solid rgba(255,255,255,0.05);
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h2>Admin Dashboard</h2>
                <button class="logout-btn" onclick="document.cookie='session=; Max-Age=0; path=/'; window.location='/admin';">Logout</button>
            </div>

            <div class="grid">
                <!-- Widget 1: File Uploader -->
                <div class="widget">
                    <h3>Upload PDF Reports</h3>
                    <p style="font-size:11px; color:#a1a1aa; margin:0;">Upload daily server health reports to the repository.</p>
                    <form method="POST" action="/admin/upload" enctype="multipart/form-data" style="display:flex; flex-direction:column; gap:8px;">
                        <input type="file" name="file" class="form-input" required />
                        <button type="submit" class="submit-btn">Upload File</button>
                    </form>
                    ${uploadMsg ? `<div class="msg" style="color: #fca5a5;">${uploadMsg}</div>` : ''}
                </div>

                <!-- Widget 2: IDOR API -->
                <div class="widget">
                    <h3>User Profile API Inspector</h3>
                    <p style="font-size:11px; color:#a1a1aa; margin:0;">Lookup local user logs via REST API query parameters.</p>
                    <div style="display:flex; gap:6px; align-items:center;">
                        <span style="font-family:monospace; font-size:11px; color:#71717a;">/api/user?id=</span>
                        <input type="text" id="idor-id" value="3" style="width:40px; background:black; color:white; border:1px solid rgba(255,255,255,0.08); text-align:center; padding:4px; border-radius:4px; font-family:monospace;" />
                        <button class="logout-btn" onclick="fetchProfile()">Query</button>
                    </div>
                    <div id="idor-result"></div>
                </div>
            </div>

            <!-- Widget 3: Ping command injection -->
            <div class="widget">
                <h3>Ping Network Diagnostics</h3>
                <p style="font-size:11px; color:#a1a1aa; margin:0;">Audit target responder connectivity. Vulnerable parameters enabled.</p>
                <form method="POST" action="/admin/ping" style="display:flex; gap:8px;">
                    <input type="text" name="address" class="form-input" style="flex-grow:1;" placeholder="e.g. 127.0.0.1" required />
                    <button type="submit" class="submit-btn" style="padding:0 24px;">Ping</button>
                </form>
                ${pingResult ? `<pre>${pingResult}</pre>` : ''}
            </div>
        </div>

        <script>
            function fetchProfile() {
                const id = document.getElementById('idor-id').value;
                const resultDiv = document.getElementById('idor-result');
                fetch('/api/user?id=' + id)
                    .then(r => r.json())
                    .then(data => {
                        if (data.status === 'success') {
                            resultDiv.innerHTML = \`<div class="msg">
                                <strong>User:</strong> \${data.user}<br />
                                <strong>Role:</strong> \${data.role}<br />
                                <strong>DB Key:</strong> <span style="color:#ef4444; font-weight:bold;">\${data.secret_creds}</span><br />
                                <strong>Home:</strong> \${data.home}
                            </div>\`;
                        } else {
                            resultDiv.innerHTML = \`<div class="msg" style="color:#f87171;">Profile matching ID not found.</div>\`;
                        }
                    })
                    .catch(() => {
                        resultDiv.innerHTML = \`<div class="msg" style="color:#f87171;">Error fetching endpoint.</div>\`;
                    });
            }
        </script>
    </body>
    </html>`;
}
