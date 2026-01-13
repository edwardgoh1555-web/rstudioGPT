/**
 * Icon Generator Script
 * Creates PNG icons for R/StudioGPT
 */

const fs = require('fs');
const path = require('path');

// Create a simple PNG icon programmatically
// This creates a 256x256 PNG with a gradient background and a simple design

function createPNG() {
    // PNG header and IHDR chunk for 256x256 RGBA image
    const width = 256;
    const height = 256;
    
    // We'll create a simple solid color icon as a placeholder
    // In production, you would use a proper image editing tool
    
    const { createCanvas } = require('canvas');
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    // Background with rounded corners effect (dark)
    ctx.fillStyle = '#0f0f23';
    ctx.beginPath();
    ctx.roundRect(0, 0, width, height, 40);
    ctx.fill();
    
    // Gradient circle
    const gradient = ctx.createLinearGradient(48, 48, 208, 208);
    gradient.addColorStop(0, '#6366f1');
    gradient.addColorStop(1, '#8b5cf6');
    
    // Outer ring
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.arc(128, 128, 80, 0, Math.PI * 2);
    ctx.stroke();
    
    // Cross lines
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    
    // Vertical line
    ctx.beginPath();
    ctx.moveTo(128, 64);
    ctx.lineTo(128, 192);
    ctx.stroke();
    
    // Horizontal line
    ctx.beginPath();
    ctx.moveTo(64, 128);
    ctx.lineTo(192, 128);
    ctx.stroke();
    
    // Center circle (filled)
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(128, 128, 24, 0, Math.PI * 2);
    ctx.fill();
    
    // Inner glow circle
    ctx.fillStyle = 'rgba(99, 102, 241, 0.3)';
    ctx.beginPath();
    ctx.arc(128, 128, 48, 0, Math.PI * 2);
    ctx.fill();
    
    // Re-draw center
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(128, 128, 24, 0, Math.PI * 2);
    ctx.fill();
    
    return canvas.toBuffer('image/png');
}

// Alternative: Create a simple placeholder if canvas isn't available
function createSimplePNG() {
    // This is a minimal valid 256x256 purple PNG encoded in base64
    // Generated from a simple icon design
    console.log('Creating placeholder icon...');
    
    // For now, we'll just log instructions
    console.log(`
To create a proper icon:
1. Use an image editor to create a 256x256 PNG
2. Save it as assets/icon.png
3. Run: npx png-to-ico assets/icon.png > assets/icon.ico

Or use online tools like:
- https://convertio.co/svg-png/
- https://cloudconvert.com/svg-to-ico
    `);
}

// Try to create icon with canvas, fallback to instructions
try {
    require.resolve('canvas');
    const buffer = createPNG();
    fs.writeFileSync(path.join(__dirname, 'assets', 'icon.png'), buffer);
    console.log('✓ Created assets/icon.png');
    
    // Also create ICO
    const pngToIco = require('png-to-ico');
    pngToIco(path.join(__dirname, 'assets', 'icon.png'))
        .then(buf => {
            fs.writeFileSync(path.join(__dirname, 'assets', 'icon.ico'), buf);
            console.log('✓ Created assets/icon.ico');
        })
        .catch(console.error);
} catch (e) {
    createSimplePNG();
}
