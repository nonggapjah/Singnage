import { describe, it, expect } from 'vitest';
import { mediaKind, isAudioFile, formatDuration } from './media-helpers';

describe('mediaKind (audio player, web 2.4.14)', () => {
    it('recognises audio, video and image by extension, case-insensitively', () => {
        expect(mediaKind('spot.mp3')).toBe('audio');
        expect(mediaKind('BGM.M4A')).toBe('audio');
        expect(mediaKind('jingle.wav')).toBe('audio');
        expect(mediaKind('raw.aac')).toBe('audio');
        expect(mediaKind('clip.mp4')).toBe('video');
        expect(mediaKind('clip.MOV')).toBe('video');
        expect(mediaKind('poster.jpg')).toBe('image');
        expect(mediaKind('poster.jpeg')).toBe('image');
        expect(mediaKind('banner.webp')).toBe('image');
    });

    it('reads URLs with query strings and paths', () => {
        expect(mediaKind('/media/abc.m4a')).toBe('audio');
        expect(mediaKind('https://host/media/x.mp3?v=2#t')).toBe('audio');
        expect(mediaKind('https://host/media/x.mp4?v=2')).toBe('video');
    });

    it('answers undefined when the name says nothing', () => {
        expect(mediaKind('')).toBeUndefined();
        expect(mediaKind(undefined)).toBeUndefined();
        expect(mediaKind(null)).toBeUndefined();
        expect(mediaKind('file.bin')).toBeUndefined();
        expect(mediaKind('noext')).toBeUndefined();
    });
});

describe('isAudioFile', () => {
    it('uses the MIME type first and the extension as a fallback', () => {
        expect(isAudioFile({ name: 'x.bin', type: 'audio/mpeg' })).toBe(true);
        expect(isAudioFile({ name: 'x.mp3', type: '' })).toBe(true);
        expect(isAudioFile({ name: 'x.mp4', type: 'video/mp4' })).toBe(false);
        expect(isAudioFile({ name: 'x.jpg', type: 'image/jpeg' })).toBe(false);
    });
});

describe('formatDuration', () => {
    it('keeps its existing shape', () => {
        expect(formatDuration(0)).toBe('-');
        expect(formatDuration(30)).toBe('0:30');
        expect(formatDuration(245)).toBe('4:05');
    });
});
