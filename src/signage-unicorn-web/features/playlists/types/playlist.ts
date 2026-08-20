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
    // BUG-06: the numeric key, carried alongside the uuid. Device records report their current
    // playlist by numeric id, so matching a device to its playlist needs this rather than
    // playlistId (which is the uuid).
    playlistRefId?: string;
    playlistName: string;
    description: string;
    createdBy: string;
    createdAt: string;
    active: 'Y' | 'N';
    items?: PlaylistItem[];
    itemCount?: number;
    totalDuration?: number;
}
