import { MediaFile } from '@/features/media/types/media';

export type { MediaFile };

export interface PlaylistItem {
    playlistItemId: string;
    playlistId: string;
    mediaId: string;
    positionOrder: number;
    durationOverride: number | null;
    active: 'Y' | 'N';
    // Joined data
    media?: MediaFile;
}

export interface Playlist {
    playlistId: string;
    playlistName: string;
    description: string;
    createdBy: string;
    createdAt: string;
    active: 'Y' | 'N';
    items?: PlaylistItem[];
    itemCount?: number;
    totalDuration?: number;
}
