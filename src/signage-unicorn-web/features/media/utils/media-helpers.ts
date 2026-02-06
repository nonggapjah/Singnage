export const getMediaMetadata = (file: File): Promise<{ duration: number; ratio: string }> => {
    return new Promise((resolve) => {
        if (file.type.startsWith('image/')) {
            const img = new Image();
            img.onload = () => {
                const ratio = `${img.width}:${img.height}`;
                resolve({ duration: 0, ratio });
            };
            img.src = URL.createObjectURL(file);
        } else if (file.type.startsWith('video/')) {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.onloadedmetadata = () => {
                window.URL.revokeObjectURL(video.src);
                const duration = Math.floor(video.duration);
                const ratio = `${video.videoWidth}:${video.videoHeight}`;
                resolve({ duration, ratio });
            };
            video.src = URL.createObjectURL(file);
        } else {
            resolve({ duration: 0, ratio: 'unknown' });
        }
    });
};

export const formatDuration = (seconds: number): string => {
    if (seconds === 0) return '-';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
};
