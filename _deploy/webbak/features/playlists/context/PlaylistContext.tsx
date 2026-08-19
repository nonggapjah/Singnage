'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Playlist, MediaFile as Media } from '../types/playlist';
import { playlistService, mediaService } from '../api/playlistService';

interface PlaylistContextType {
    playlists: Playlist[];
    loading: boolean;
    activePlaylist: Playlist | null;
    mediaLibrary: Media[];
    fetchPlaylists: () => Promise<void>;
    fetchMediaLibrary: () => Promise<void>;
    selectPlaylist: (id: string) => Promise<void>;
    createPlaylist: (name: string, description?: string) => Promise<void>;
}

const PlaylistContext = createContext<PlaylistContextType | undefined>(undefined);

export const PlaylistProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [playlists, setPlaylists] = useState<Playlist[]>([]);
    const [loading, setLoading] = useState(false);
    const [activePlaylist, setActivePlaylist] = useState<Playlist | null>(null);
    const [mediaLibrary, setMediaLibrary] = useState<Media[]>([]);

    const fetchPlaylists = useCallback(async () => {
        setLoading(true);
        const res = await playlistService.getAll();
        if (res.success) {
            setPlaylists(res.data || []);
        }
        setLoading(false);
    }, []);

    const fetchMediaLibrary = useCallback(async () => {
        const res = await mediaService.getAll();
        if (res.success) {
            setMediaLibrary(res.data || []);
        }
    }, []);

    const selectPlaylist = async (id: string) => {
        const res = await playlistService.getById(id);
        if (res.success) {
            setActivePlaylist(res.data);
        }
    };

    const createPlaylist = async (name: string, description?: string) => {
        const res = await playlistService.create({ playlistName: name, description });
        if (res.success) {
            await fetchPlaylists();
        }
    };

    useEffect(() => {
        fetchPlaylists();
        fetchMediaLibrary();
    }, [fetchPlaylists, fetchMediaLibrary]);

    return (
        <PlaylistContext.Provider
            value={{
                playlists,
                loading,
                activePlaylist,
                mediaLibrary,
                fetchPlaylists,
                fetchMediaLibrary,
                selectPlaylist,
                createPlaylist,
            }}
        >
            {children}
        </PlaylistContext.Provider>
    );
};

export const usePlaylists = () => {
    const context = useContext(PlaylistContext);
    if (!context) throw new Error('usePlaylists must be used within a PlaylistProvider');
    return context;
};
