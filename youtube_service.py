"""
Python YouTube Service - Handles all YouTube operations
This service is called by the Node.js bot
"""
import sys
import json
import yt_dlp
import tempfile
import os

def search_youtube(query, limit=5):
    """Search YouTube and return results"""
    try:
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'extract_flat': 'in_playlist',
        }
        
        search_query = f'ytsearch{limit}:{query}'
        videos = []
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            results = ydl.extract_info(search_query, download=False)
            if 'entries' in results:
                videos = results['entries'][:limit]
                
                # Get full info for each video
                for i, video in enumerate(videos):
                    if not video.get('duration') or not video.get('thumbnail'):
                        try:
                            video_url = video.get('url') or f"https://www.youtube.com/watch?v={video.get('id', '')}"
                            full_info = ydl.extract_info(video_url, download=False)
                            videos[i].update({
                                'title': full_info.get('title', video.get('title', 'No title')),
                                'duration': full_info.get('duration', video.get('duration', 0)),
                                'thumbnail': full_info.get('thumbnail', video.get('thumbnail', '')),
                                'view_count': full_info.get('view_count', video.get('view_count', 0)),
                                'channel': full_info.get('channel', full_info.get('uploader', video.get('channel', 'Unknown'))),
                                'webpage_url': full_info.get('webpage_url', video.get('url', video_url)),
                                'id': full_info.get('id', video.get('id', ''))
                            })
                        except:
                            pass
        
        return {'success': True, 'videos': videos}
    except Exception as e:
        return {'success': False, 'error': str(e)}

def get_video_info(url):
    """Get video information"""
    try:
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
        }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            return {
                'success': True,
                'info': {
                    'title': info.get('title', 'Video'),
                    'id': info.get('id', ''),
                    'duration': info.get('duration', 0),
                    'thumbnail': info.get('thumbnail', ''),
                    'channel': info.get('channel', info.get('uploader', 'Unknown')),
                    'view_count': info.get('view_count', 0)
                }
            }
    except Exception as e:
        return {'success': False, 'error': str(e)}

def progress_hook(d):
    """Progress hook for yt-dlp to report download progress"""
    if d['status'] == 'downloading':
        total = d.get('total_bytes') or d.get('total_bytes_estimate', 0)
        downloaded = d.get('downloaded_bytes', 0)
        speed = d.get('speed', 0)
        
        if total > 0:
            percent = (downloaded / total) * 100
            # Output progress to stderr (not stdout) so it doesn't interfere with JSON output
            progress_data = {
                'type': 'progress',
                'percent': round(percent, 2),
                'downloaded': downloaded,
                'total': total,
                'speed': speed,
                'eta': d.get('eta', 0)
            }
            print(f"PROGRESS:{json.dumps(progress_data)}", file=sys.stderr, flush=True)
        else:
            # If total is unknown, show speed only
            progress_data = {
                'type': 'progress',
                'percent': 0,
                'downloaded': downloaded,
                'total': 0,
                'speed': speed,
                'eta': d.get('eta', 0)
            }
            print(f"PROGRESS:{json.dumps(progress_data)}", file=sys.stderr, flush=True)
    elif d['status'] == 'finished':
        progress_data = {
            'type': 'progress',
            'percent': 100,
            'status': 'finished'
        }
        print(f"PROGRESS:{json.dumps(progress_data)}", file=sys.stderr, flush=True)

def download_video(url, output_dir, quality='360'):
    """Download video and return path - Optimized for speed and quality"""
    try:
        # Quality format selectors - optimized for faster downloads
        quality_map = {
            '240': 'worst[height<=240]/worst',  # Fastest
            '360': 'best[height<=360]/best[height<=360]',  # Fast
            '480': 'best[height<=480]/best[height<=480]',
            '720': 'best[height<=720]/best[height<=720]',
            '1080': 'best[height<=1080]/best[height<=1080]',  # Full HD - best quality
        }
        
        # Get format selector based on quality
        format_selector = quality_map.get(quality, 'best[height<=360]/best[height<=360]')
        
        ydl_opts = {
            'format': format_selector,
            'outtmpl': os.path.join(output_dir, '%(id)s.%(ext)s'),
            'quiet': True,  # Suppress yt-dlp's own progress output
            'no_warnings': True,
            # Optimized for speed
            'socket_timeout': 10,  # Reduced timeout for faster failure detection
            'retries': 2,  # Reduced retries for speed
            'fragment_retries': 2,
            'concurrent_fragments': 4,  # Download fragments in parallel for speed
            'http_chunk_size': 10485760,  # 10MB chunks for faster download
            'noprogress': True,  # Disable yt-dlp's default progress output
            'extract_flat': False,
            # Speed optimizations
            'prefer_insecure': False,
            'nocheckcertificate': False,
            'no_check_certificate': False,
            'progress_hooks': [progress_hook],  # Add our custom progress hook
            # For 1080p and long videos, use best available format
            'merge_output_format': 'mp4',  # Prefer MP4 for better compatibility
        }
        
        # For 1080p, prefer best quality available
        if quality == '1080':
            ydl_opts['format'] = 'best[height<=1080]/bestvideo[height<=1080]+bestaudio/best[height<=1080]'
        
        # First, get video info to optimize format selection
        with yt_dlp.YoutubeDL({'quiet': True, 'no_warnings': True}) as ydl_info:
            info = ydl_info.extract_info(url, download=False)
            video_id = info.get('id', '')
            title = info.get('title', 'Video')
            
            # Optimize format selection for speed
            # Prefer formats that are already available (no conversion needed)
            available_formats = info.get('formats', [])
            if available_formats:
                # Find the best matching format quickly
                target_height = int(quality) if quality.isdigit() else 360
                # Prefer mp4/webm formats (faster, no conversion)
                preferred_formats = [f for f in available_formats 
                                   if f.get('height') and f.get('height') <= target_height
                                   and f.get('vcodec') != 'none'
                                   and f.get('acodec') != 'none']
                
                if preferred_formats:
                    # Use format with best quality that's still fast
                    best_format = max(preferred_formats, key=lambda x: x.get('height', 0))
                    format_id = best_format.get('format_id')
                    if format_id:
                        format_selector = format_id
                        ydl_opts['format'] = format_selector
        
        # Now download with optimized settings
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            try:
                ydl.download([url])
            except Exception as download_error:
                # If download fails, return error
                return {'success': False, 'error': str(download_error)}
        
        # Find downloaded file (after download completes)
        for file in os.listdir(output_dir):
            if file.startswith(video_id):
                file_path = os.path.join(output_dir, file)
                file_size = os.path.getsize(file_path)
                return {
                    'success': True,
                    'file_path': file_path,
                    'file_size': file_size,
                    'title': title,
                    'video_id': video_id
                }
        
        return {'success': False, 'error': 'File not found after download'}
    except Exception as e:
        return {'success': False, 'error': str(e)}

def split_video(file_path, output_dir, max_size_mb=1800):
    """
    Split video into chunks that are under max_size_mb (default 1800MB = 1.8GB)
    Returns list of file paths for the split parts
    """
    try:
        import subprocess
        import math
        
        ffmpeg_dir = find_ffmpeg()
        if not ffmpeg_dir:
            return {'success': False, 'error': 'FFmpeg not found. Required for video splitting.'}
        
        ffmpeg_exe = os.path.join(ffmpeg_dir, 'ffmpeg.exe') if os.name == 'nt' else os.path.join(ffmpeg_dir, 'ffmpeg')
        if not os.path.exists(ffmpeg_exe):
            return {'success': False, 'error': 'FFmpeg executable not found.'}
        
        # Get video duration
        probe_cmd = [
            ffmpeg_exe.replace('ffmpeg', 'ffprobe') if os.name == 'nt' else ffmpeg_exe.replace('ffmpeg', 'ffprobe'),
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            file_path
        ]
        
        try:
            duration_str = subprocess.check_output(probe_cmd, stderr=subprocess.DEVNULL).decode().strip()
            duration = float(duration_str)
        except:
            # Fallback: estimate duration from file size (rough estimate)
            file_size = os.path.getsize(file_path)
            # Assume average bitrate of 5 Mbps for 1080p
            duration = (file_size * 8) / (5 * 1000000)  # Convert bytes to seconds
        
        # Get file size
        file_size = os.path.getsize(file_path)
        file_size_mb = file_size / (1024 * 1024)
        
        # Calculate number of parts needed
        max_size_bytes = max_size_mb * 1024 * 1024
        num_parts = math.ceil(file_size_mb / max_size_mb)
        
        # Calculate duration per part
        duration_per_part = duration / num_parts
        
        # Get base filename
        base_name = os.path.splitext(os.path.basename(file_path))[0]
        ext = os.path.splitext(file_path)[1]
        
        parts = []
        
        # Split video into parts
        for i in range(num_parts):
            start_time = i * duration_per_part
            output_file = os.path.join(output_dir, f"{base_name}_part{i+1:02d}{ext}")
            
            # Use FFmpeg to split video
            split_cmd = [
                ffmpeg_exe,
                '-i', file_path,
                '-ss', str(start_time),
                '-t', str(duration_per_part),
                '-c', 'copy',  # Copy codec (no re-encoding, very fast)
                '-avoid_negative_ts', 'make_zero',
                '-y',  # Overwrite output file
                output_file
            ]
            
            try:
                # Run FFmpeg
                result = subprocess.run(
                    split_cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=600  # 10 minute timeout per part
                )
                
                if result.returncode != 0:
                    return {'success': False, 'error': f'FFmpeg split failed for part {i+1}: {result.stderr.decode()[:200]}'}
                
                # Check if file was created and has reasonable size
                if os.path.exists(output_file) and os.path.getsize(output_file) > 0:
                    parts.append({
                        'path': output_file,
                        'size': os.path.getsize(output_file),
                        'part_number': i + 1,
                        'total_parts': num_parts
                    })
                else:
                    return {'success': False, 'error': f'Part {i+1} was not created properly'}
                    
            except subprocess.TimeoutExpired:
                return {'success': False, 'error': f'Split operation timed out for part {i+1}'}
            except Exception as e:
                return {'success': False, 'error': f'Error splitting part {i+1}: {str(e)}'}
        
        return {
            'success': True,
            'parts': parts,
            'original_file': file_path,
            'total_parts': num_parts
        }
        
    except Exception as e:
        return {'success': False, 'error': f'Video splitting error: {str(e)}'}

def find_ffmpeg():
    """Try to find FFmpeg in common locations"""
    import shutil
    
    # First try PATH
    ffmpeg_path = shutil.which('ffmpeg')
    if ffmpeg_path:
        return os.path.dirname(ffmpeg_path)
    
    # Try common Windows locations
    common_paths = [
        r'C:\ffmpeg\bin',
        r'C:\Program Files\ffmpeg\bin',
        r'C:\Program Files (x86)\ffmpeg\bin',
        os.path.join(os.path.expanduser('~'), 'ffmpeg', 'bin'),
    ]
    
    for path in common_paths:
        ffmpeg_exe = os.path.join(path, 'ffmpeg.exe')
        if os.path.exists(ffmpeg_exe):
            return path
    
    return None

def download_playlist(url, output_dir, quality='360', max_videos=None):
    """Download entire playlist"""
    try:
        quality_map = {
            '240': 'worst[height<=240]/worst',
            '360': 'best[height<=360]/best[height<=360]',
            '480': 'best[height<=480]/best[height<=480]',
            '720': 'best[height<=720]/best[height<=720]',
            '1080': 'best[height<=1080]/best[height<=1080]',
        }
        format_selector = quality_map.get(quality, 'best[height<=360]/best[height<=360]')
        
        ydl_opts = {
            'format': format_selector,
            'outtmpl': os.path.join(output_dir, '%(playlist_index)s - %(title)s.%(ext)s'),
            'quiet': True,
            'no_warnings': True,
            'socket_timeout': 10,
            'retries': 2,
            'fragment_retries': 2,
            'concurrent_fragments': 4,
            'http_chunk_size': 10485760,
            'noprogress': True,
            'merge_output_format': 'mp4',
        }
        
        if max_videos:
            ydl_opts['playlistend'] = max_videos
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            playlist_title = info.get('title', 'Playlist')
            entries = info.get('entries', [])
            total_videos = len(entries) if entries else 0
            
            if total_videos == 0:
                return {'success': False, 'error': 'No videos found in playlist'}
            
            # Download
            ydl.download([url])
            
            # Find downloaded files
            downloaded_files = []
            for file in os.listdir(output_dir):
                if any(file.startswith(f"{i+1} -") for i in range(total_videos)):
                    file_path = os.path.join(output_dir, file)
                    if os.path.exists(file_path):
                        downloaded_files.append({
                            'path': file_path,
                            'size': os.path.getsize(file_path),
                            'title': file
                        })
            
            return {
                'success': True,
                'playlist_title': playlist_title,
                'total_videos': total_videos,
                'downloaded': len(downloaded_files),
                'files': downloaded_files
            }
    except Exception as e:
        return {'success': False, 'error': str(e)}

def download_channel(url, output_dir, quality='360', max_videos=50):
    """Download videos from a channel"""
    try:
        quality_map = {
            '240': 'worst[height<=240]/worst',
            '360': 'best[height<=360]/best[height<=360]',
            '480': 'best[height<=480]/best[height<=480]',
            '720': 'best[height<=720]/best[height<=720]',
            '1080': 'best[height<=1080]/best[height<=1080]',
        }
        format_selector = quality_map.get(quality, 'best[height<=360]/best[height<=360]')
        
        ydl_opts = {
            'format': format_selector,
            'outtmpl': os.path.join(output_dir, '%(uploader)s - %(title)s.%(ext)s'),
            'quiet': True,
            'no_warnings': True,
            'socket_timeout': 10,
            'retries': 2,
            'fragment_retries': 2,
            'concurrent_fragments': 4,
            'http_chunk_size': 10485760,
            'noprogress': True,
            'merge_output_format': 'mp4',
            'playlistend': max_videos,
        }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            channel_name = info.get('uploader', info.get('channel', 'Channel'))
            entries = info.get('entries', [])
            total_videos = len(entries) if entries else 0
            
            if total_videos == 0:
                return {'success': False, 'error': 'No videos found in channel'}
            
            # Download
            ydl.download([url])
            
            # Find downloaded files
            downloaded_files = []
            for file in os.listdir(output_dir):
                if file.startswith(channel_name):
                    file_path = os.path.join(output_dir, file)
                    if os.path.exists(file_path):
                        downloaded_files.append({
                            'path': file_path,
                            'size': os.path.getsize(file_path),
                            'title': file
                        })
            
            return {
                'success': True,
                'channel_name': channel_name,
                'total_videos': total_videos,
                'downloaded': len(downloaded_files),
                'files': downloaded_files
            }
    except Exception as e:
        return {'success': False, 'error': str(e)}

def download_subtitle(url, output_dir, lang='en'):
    """Download subtitles from video"""
    try:
        ydl_opts = {
            'writesubtitles': True,
            'writeautomaticsub': True,
            'subtitleslangs': [lang, 'en'],
            'skip_download': True,
            'outtmpl': os.path.join(output_dir, '%(id)s.%(ext)s'),
            'quiet': True,
            'no_warnings': True,
        }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            video_id = info.get('id', '')
            title = info.get('title', 'Video')
            
            ydl.download([url])
            
            # Find subtitle files
            subtitle_files = []
            for file in os.listdir(output_dir):
                if file.startswith(video_id) and file.endswith(('.vtt', '.srt', '.ttml')):
                    file_path = os.path.join(output_dir, file)
                    subtitle_files.append({
                        'path': file_path,
                        'size': os.path.getsize(file_path),
                        'lang': lang,
                        'title': title
                    })
            
            if subtitle_files:
                return {
                    'success': True,
                    'subtitle_files': subtitle_files,
                    'title': title
                }
            else:
                return {'success': False, 'error': 'No subtitles found'}
    except Exception as e:
        return {'success': False, 'error': str(e)}

def download_thumbnail(url, output_dir):
    """Download video thumbnail"""
    try:
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
        }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            video_id = info.get('id', '')
            title = info.get('title', 'Video')
            thumbnail_url = info.get('thumbnail', '')
            
            if not thumbnail_url:
                return {'success': False, 'error': 'No thumbnail available'}
            
            # Download thumbnail
            import urllib.request
            thumbnail_path = os.path.join(output_dir, f'{video_id}_thumbnail.jpg')
            urllib.request.urlretrieve(thumbnail_url, thumbnail_path)
            
            return {
                'success': True,
                'thumbnail_path': thumbnail_path,
                'thumbnail_url': thumbnail_url,
                'title': title,
                'video_id': video_id
            }
    except Exception as e:
        return {'success': False, 'error': str(e)}

def compress_video(file_path, output_dir, quality='medium'):
    """Compress video file"""
    try:
        ffmpeg_dir = find_ffmpeg()
        if not ffmpeg_dir:
            return {'success': False, 'error': 'FFmpeg not found'}
        
        ffmpeg_exe = os.path.join(ffmpeg_dir, 'ffmpeg.exe') if os.name == 'nt' else os.path.join(ffmpeg_dir, 'ffmpeg')
        
        # Quality presets
        crf_map = {
            'low': '28',      # Lower quality, smaller file
            'medium': '23',   # Balanced
            'high': '18'      # Higher quality, larger file
        }
        crf = crf_map.get(quality, '23')
        
        base_name = os.path.splitext(os.path.basename(file_path))[0]
        ext = os.path.splitext(file_path)[1]
        output_path = os.path.join(output_dir, f'{base_name}_compressed{ext}')
        
        cmd = [
            ffmpeg_exe,
            '-i', file_path,
            '-c:v', 'libx264',
            '-crf', crf,
            '-preset', 'medium',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-y',
            output_path
        ]
        
        import subprocess
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=600)
        
        if result.returncode == 0 and os.path.exists(output_path):
            original_size = os.path.getsize(file_path)
            compressed_size = os.path.getsize(output_path)
            compression_ratio = ((original_size - compressed_size) / original_size) * 100
            
            return {
                'success': True,
                'output_path': output_path,
                'original_size': original_size,
                'compressed_size': compressed_size,
                'compression_ratio': round(compression_ratio, 2)
            }
        else:
            return {'success': False, 'error': 'Compression failed'}
    except Exception as e:
        return {'success': False, 'error': str(e)}

def download_audio(url, output_dir):
    """Download audio only (MP3) and return path"""
    try:
        # Check if FFmpeg is available
        ffmpeg_dir = find_ffmpeg()
        
        # First try with MP3 conversion (requires ffmpeg)
        ydl_opts = {
            'format': 'bestaudio/best',
            'outtmpl': os.path.join(output_dir, '%(id)s.%(ext)s'),
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
            'quiet': True,
            'no_warnings': True,
            'socket_timeout': 30,
            'retries': 3,
        }
        
        # If FFmpeg is found, specify the path
        if ffmpeg_dir:
            ydl_opts['ffmpeg_location'] = ffmpeg_dir
            print(f"Using FFmpeg from: {ffmpeg_dir}", file=sys.stderr, flush=True)
        else:
            print("FFmpeg not found in PATH or common locations", file=sys.stderr, flush=True)
        
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                video_id = info.get('id', '')
                title = info.get('title', 'Audio')
                
                # Download
                ydl.download([url])
                
                # Wait a bit for conversion to complete
                import time
                time.sleep(1)
                
                # Find downloaded file - check for .mp3 extension first
                # yt-dlp might create the file with video_id.mp3
                mp3_files = []
                other_files = []
                
                for file in os.listdir(output_dir):
                    if file.startswith(video_id):
                        file_path = os.path.join(output_dir, file)
                        if file.endswith('.mp3'):
                            mp3_files.append(file_path)
                        elif file.endswith(('.m4a', '.webm', '.opus', '.ogg', '.aac')):
                            other_files.append(file_path)
                
                # Prefer MP3 files
                if mp3_files:
                    file_path = mp3_files[0]
                    file_size = os.path.getsize(file_path)
                    return {
                        'success': True,
                        'file_path': file_path,
                        'file_size': file_size,
                        'title': title,
                        'video_id': video_id
                    }
                
                # If no MP3 found but other formats exist, FFmpeg conversion might have failed
                if other_files:
                    # Try to find if there's a converted MP3 with different name
                    for file in os.listdir(output_dir):
                        if file.endswith('.mp3') and os.path.getsize(os.path.join(output_dir, file)) > 0:
                            file_path = os.path.join(output_dir, file)
                            file_size = os.path.getsize(file_path)
                            return {
                                'success': True,
                                'file_path': file_path,
                                'file_size': file_size,
                                'title': title,
                                'video_id': video_id
                            }
                    
                    # Return original format if MP3 conversion failed
                    file_path = other_files[0]
                    file_size = os.path.getsize(file_path)
                    return {
                        'success': True,
                        'file_path': file_path,
                        'file_size': file_size,
                        'title': title,
                        'video_id': video_id,
                        'format': 'audio (original format, MP3 conversion failed)',
                        'error': 'MP3 conversion failed. FFmpeg might not be properly configured.'
                    }
                
        except Exception as ffmpeg_error:
            # If ffmpeg is not available, try downloading audio in original format
            error_str = str(ffmpeg_error).lower()
            if 'ffmpeg' in error_str or 'ffprobe' in error_str or 'postprocess' in error_str:
                # Fallback: Download best audio format without conversion
                ydl_opts_fallback = {
                    'format': 'bestaudio/best',
                    'outtmpl': os.path.join(output_dir, '%(id)s.%(ext)s'),
                    'quiet': True,
                    'no_warnings': True,
                    'socket_timeout': 30,
                    'retries': 3,
                }
                
                try:
                    with yt_dlp.YoutubeDL(ydl_opts_fallback) as ydl:
                        info = ydl.extract_info(url, download=False)
                        video_id = info.get('id', '')
                        title = info.get('title', 'Audio')
                        
                        # Download
                        ydl.download([url])
                        
                        # Find downloaded audio file (could be m4a, webm, opus, etc.)
                        for file in os.listdir(output_dir):
                            if file.startswith(video_id):
                                file_path = os.path.join(output_dir, file)
                                # Check if it's an audio file
                                if file.endswith(('.m4a', '.webm', '.opus', '.ogg', '.mp3', '.aac')):
                                    file_size = os.path.getsize(file_path)
                                    return {
                                        'success': True,
                                        'file_path': file_path,
                                        'file_size': file_size,
                                        'title': title,
                                        'video_id': video_id,
                                        'format': 'audio (original format, not MP3)',
                                        'error': 'FFmpeg not found in PATH. Please add FFmpeg to PATH or restart terminal after installation.'
                                    }
                    
                    return {'success': False, 'error': 'FFmpeg not found. Please install FFmpeg and add it to PATH. See INSTALL_FFMPEG.md for instructions.'}
                except Exception as fallback_error:
                    return {'success': False, 'error': f'Audio download failed: {str(fallback_error)}'}
            else:
                raise ffmpeg_error
            
        return {'success': False, 'error': 'File not found after download'}
    except Exception as e:
        error_msg = str(e)
        if 'ffmpeg' in error_msg.lower() or 'ffprobe' in error_msg.lower():
            return {'success': False, 'error': 'FFmpeg not found. Please install FFmpeg and add it to PATH. Restart terminal after installation. See INSTALL_FFMPEG.md for instructions.'}
        return {'success': False, 'error': error_msg}

# Main handler
if __name__ == '__main__':
    try:
        command = sys.argv[1] if len(sys.argv) > 1 else ''
        
        if command == 'search':
            query = sys.argv[2] if len(sys.argv) > 2 else ''
            limit = int(sys.argv[3]) if len(sys.argv) > 3 else 5
            result = search_youtube(query, limit)
            print(json.dumps(result))
        
        elif command == 'info':
            url = sys.argv[2] if len(sys.argv) > 2 else ''
            result = get_video_info(url)
            print(json.dumps(result))
        
        elif command == 'download':
            url = sys.argv[2] if len(sys.argv) > 2 else ''
            output_dir = sys.argv[3] if len(sys.argv) > 3 else tempfile.mkdtemp()
            quality = sys.argv[4] if len(sys.argv) > 4 else '360'
            result = download_video(url, output_dir, quality)
            print(json.dumps(result))
        
        elif command == 'audio':
            url = sys.argv[2] if len(sys.argv) > 2 else ''
            output_dir = sys.argv[3] if len(sys.argv) > 3 else tempfile.mkdtemp()
            result = download_audio(url, output_dir)
            print(json.dumps(result))
        
        elif command == 'split':
            file_path = sys.argv[2] if len(sys.argv) > 2 else ''
            output_dir = sys.argv[3] if len(sys.argv) > 3 else os.path.dirname(file_path)
            max_size_mb = float(sys.argv[4]) if len(sys.argv) > 4 else 1800
            result = split_video(file_path, output_dir, max_size_mb)
            print(json.dumps(result))
        
        elif command == 'playlist':
            url = sys.argv[2] if len(sys.argv) > 2 else ''
            output_dir = sys.argv[3] if len(sys.argv) > 3 else tempfile.mkdtemp()
            quality = sys.argv[4] if len(sys.argv) > 4 else '360'
            max_videos = int(sys.argv[5]) if len(sys.argv) > 5 else None
            result = download_playlist(url, output_dir, quality, max_videos)
            print(json.dumps(result))
        
        elif command == 'channel':
            url = sys.argv[2] if len(sys.argv) > 2 else ''
            output_dir = sys.argv[3] if len(sys.argv) > 3 else tempfile.mkdtemp()
            quality = sys.argv[4] if len(sys.argv) > 4 else '360'
            max_videos = int(sys.argv[5]) if len(sys.argv) > 5 else 50
            result = download_channel(url, output_dir, quality, max_videos)
            print(json.dumps(result))
        
        elif command == 'subtitle':
            url = sys.argv[2] if len(sys.argv) > 2 else ''
            output_dir = sys.argv[3] if len(sys.argv) > 3 else tempfile.mkdtemp()
            lang = sys.argv[4] if len(sys.argv) > 4 else 'en'
            result = download_subtitle(url, output_dir, lang)
            print(json.dumps(result))
        
        elif command == 'thumbnail':
            url = sys.argv[2] if len(sys.argv) > 2 else ''
            output_dir = sys.argv[3] if len(sys.argv) > 3 else tempfile.mkdtemp()
            result = download_thumbnail(url, output_dir)
            print(json.dumps(result))
        
        elif command == 'compress':
            file_path = sys.argv[2] if len(sys.argv) > 2 else ''
            output_dir = sys.argv[3] if len(sys.argv) > 3 else os.path.dirname(file_path)
            quality = sys.argv[4] if len(sys.argv) > 4 else 'medium'
            result = compress_video(file_path, output_dir, quality)
            print(json.dumps(result))
        
        else:
            print(json.dumps({'success': False, 'error': 'Invalid command'}))
    
    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}))

