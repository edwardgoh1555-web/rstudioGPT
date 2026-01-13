/**
 * Simple Icon Generator
 * Creates a basic PNG icon for R/StudioGPT
 * Uses pure Node.js - no external image libraries required
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const WIDTH = 256;
const HEIGHT = 256;

// Create raw RGBA pixel data
function createPixelData() {
    const pixels = Buffer.alloc(WIDTH * HEIGHT * 4);
    
    const centerX = WIDTH / 2;
    const centerY = HEIGHT / 2;
    
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const idx = (y * WIDTH + x) * 4;
            
            // Distance from center
            const dx = x - centerX;
            const dy = y - centerY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            // Background (dark purple)
            let r = 15, g = 15, b = 35, a = 255;
            
            // Rounded corners
            const cornerRadius = 40;
            const inCorner = (
                (x < cornerRadius && y < cornerRadius && Math.sqrt((x-cornerRadius)**2 + (y-cornerRadius)**2) > cornerRadius) ||
                (x > WIDTH-cornerRadius && y < cornerRadius && Math.sqrt((x-(WIDTH-cornerRadius))**2 + (y-cornerRadius)**2) > cornerRadius) ||
                (x < cornerRadius && y > HEIGHT-cornerRadius && Math.sqrt((x-cornerRadius)**2 + (y-(HEIGHT-cornerRadius))**2) > cornerRadius) ||
                (x > WIDTH-cornerRadius && y > HEIGHT-cornerRadius && Math.sqrt((x-(WIDTH-cornerRadius))**2 + (y-(HEIGHT-cornerRadius))**2) > cornerRadius)
            );
            
            if (inCorner) {
                a = 0; // Transparent corners
            }
            
            // Outer ring (radius 75-85)
            if (dist >= 70 && dist <= 90) {
                const t = (x + y) / (WIDTH + HEIGHT); // Gradient direction
                r = Math.floor(99 + (139 - 99) * t);
                g = Math.floor(102 + (92 - 102) * t);
                b = Math.floor(241 + (246 - 241) * t);
            }
            
            // Cross - vertical line (x: 120-136, y: 56-200)
            if (x >= 120 && x <= 136 && y >= 56 && y <= 200 && dist > 45) {
                const t = y / HEIGHT;
                r = Math.floor(99 + (139 - 99) * t);
                g = Math.floor(102 + (92 - 102) * t);
                b = Math.floor(241 + (246 - 241) * t);
            }
            
            // Cross - horizontal line (y: 120-136, x: 56-200)
            if (y >= 120 && y <= 136 && x >= 56 && x <= 200 && dist > 45) {
                const t = x / WIDTH;
                r = Math.floor(99 + (139 - 99) * t);
                g = Math.floor(102 + (92 - 102) * t);
                b = Math.floor(241 + (246 - 241) * t);
            }
            
            // Inner glow (radius 35-50)
            if (dist >= 35 && dist <= 50) {
                r = Math.floor(99 * 0.5);
                g = Math.floor(102 * 0.5);
                b = Math.floor(241 * 0.5);
                a = 200;
            }
            
            // Center dot (radius < 28)
            if (dist < 28) {
                const t = (x + y) / (WIDTH + HEIGHT);
                r = Math.floor(99 + (139 - 99) * t);
                g = Math.floor(102 + (92 - 102) * t);
                b = Math.floor(241 + (246 - 241) * t);
            }
            
            pixels[idx] = r;
            pixels[idx + 1] = g;
            pixels[idx + 2] = b;
            pixels[idx + 3] = a;
        }
    }
    
    return pixels;
}

// Create PNG file
function createPNG(pixels) {
    // PNG signature
    const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    
    // IHDR chunk
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(WIDTH, 0);
    ihdrData.writeUInt32BE(HEIGHT, 4);
    ihdrData.writeUInt8(8, 8);  // bit depth
    ihdrData.writeUInt8(6, 9);  // color type (RGBA)
    ihdrData.writeUInt8(0, 10); // compression
    ihdrData.writeUInt8(0, 11); // filter
    ihdrData.writeUInt8(0, 12); // interlace
    const ihdr = createChunk('IHDR', ihdrData);
    
    // IDAT chunk - image data with filter bytes
    const rawData = Buffer.alloc(HEIGHT * (1 + WIDTH * 4));
    for (let y = 0; y < HEIGHT; y++) {
        rawData[y * (1 + WIDTH * 4)] = 0; // No filter
        pixels.copy(rawData, y * (1 + WIDTH * 4) + 1, y * WIDTH * 4, (y + 1) * WIDTH * 4);
    }
    const compressed = zlib.deflateSync(rawData, { level: 9 });
    const idat = createChunk('IDAT', compressed);
    
    // IEND chunk
    const iend = createChunk('IEND', Buffer.alloc(0));
    
    return Buffer.concat([signature, ihdr, idat, iend]);
}

function createChunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    
    const typeBuffer = Buffer.from(type, 'ascii');
    const crcData = Buffer.concat([typeBuffer, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(crcData), 0);
    
    return Buffer.concat([length, typeBuffer, data, crc]);
}

// CRC32 calculation
function crc32(data) {
    let crc = 0xFFFFFFFF;
    const table = [];
    
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c;
    }
    
    for (let i = 0; i < data.length; i++) {
        crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Main
console.log('Generating icon...');
const pixels = createPixelData();
const png = createPNG(pixels);

const assetsDir = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
}

fs.writeFileSync(path.join(assetsDir, 'icon.png'), png);
console.log('✓ Created assets/icon.png (256x256)');

// Generate ICO from PNG
try {
    const pngToIco = require('png-to-ico');
    pngToIco(path.join(assetsDir, 'icon.png'))
        .then(buf => {
            fs.writeFileSync(path.join(assetsDir, 'icon.ico'), buf);
            console.log('✓ Created assets/icon.ico');
        })
        .catch(err => console.log('Note: Could not create .ico file:', err.message));
} catch (e) {
    console.log('Note: png-to-ico not available, skipping .ico generation');
}
