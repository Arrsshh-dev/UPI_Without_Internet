import os
from PIL import Image, ImageDraw

def create_icon(size, out_path):
    img = Image.new('RGBA', (size, size), (24, 24, 27, 255)) # #18181B
    draw = ImageDraw.Draw(img)
    
    # Draw rounded inner card / badge
    pad = int(size * 0.18)
    rect = [pad, pad, size - pad, size - pad]
    radius = int(size * 0.12)
    draw.rounded_rectangle(rect, radius=radius, outline=(255, 255, 255, 255), width=max(2, int(size * 0.04)))
    
    # Draw central signal / payment dot & wave
    center_x = size // 2
    center_y = size // 2
    
    # Center dot
    dot_r = max(3, int(size * 0.05))
    draw.ellipse([center_x - dot_r, center_y - dot_r, center_x + dot_r, center_y + dot_r], fill=(255, 255, 255, 255))
    
    # Broadcast arcs
    w = max(2, int(size * 0.035))
    # Inner arc
    r1 = int(size * 0.14)
    draw.arc([center_x - r1, center_y - r1, center_x + r1, center_y + r1], start=210, end=330, fill=(255, 255, 255, 255), width=w)
    draw.arc([center_x - r1, center_y - r1, center_x + r1, center_y + r1], start=30, end=150, fill=(255, 255, 255, 255), width=w)
    
    # Save
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    img.save(out_path, 'PNG')
    print(f"Generated {out_path} ({size}x{size})")

if __name__ == '__main__':
    base_dir = r"C:\Users\arshp\UPI_Without_Internet\web-sender\public"
    create_icon(192, os.path.join(base_dir, "pwa-192x192.png"))
    create_icon(512, os.path.join(base_dir, "pwa-512x512.png"))
    create_icon(180, os.path.join(base_dir, "apple-touch-icon.png"))
    create_icon(64, os.path.join(base_dir, "favicon.png"))
