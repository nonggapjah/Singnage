import { apiFetch, ApiResponse, type ApiFetchInit } from '@/lib/api-fetch';
import { MediaFile, MediaUploadRequest, MediaUsage } from '../types/media';

export const mediaApi = {
    getAll: async (filters: { searchTerm?: string, supplierCode?: string, remark1?: string, remark2?: string, status?: string, mediaType?: string } = {}): Promise<ApiResponse<MediaFile[]>> => {
        const params = new URLSearchParams();
        if (filters.searchTerm) params.append('searchTerm', filters.searchTerm);
        if (filters.supplierCode) params.append('supplierCode', filters.supplierCode);
        if (filters.remark1) params.append('remark1', filters.remark1);
        if (filters.remark2) params.append('remark2', filters.remark2);
        if (filters.status && filters.status !== 'all') params.append('status', filters.status);
        if (filters.mediaType && filters.mediaType !== 'all') params.append('mediaType', filters.mediaType);

        const queryString = params.toString();
        return apiFetch(`/media${queryString ? `?${queryString}` : ''}`);
    },

    /** `init` lets the web player pass `{ scope: 'device', deviceToken }` (round-4 #9). */
    getById: async (id: string, init?: ApiFetchInit): Promise<ApiResponse<MediaFile>> => {
        return apiFetch(`/media/${id}`, init);
    },

    upload: async (data: MediaUploadRequest | FormData): Promise<ApiResponse<MediaFile>> => {
        const isFormData = data instanceof FormData;
        return apiFetch('/media', {
            method: 'POST',
            body: isFormData ? data : JSON.stringify(data),
        }, true); // isUpload=true: use 10 min timeout
    },

    update: async (id: string, data: Partial<MediaFile>): Promise<ApiResponse<boolean>> => {
        return apiFetch(`/media/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    delete: async (id: string, force: boolean = false): Promise<ApiResponse<any>> => {
        return apiFetch(`/media/${id}${force ? '?force=true' : ''}`, {
            method: 'DELETE',
        });
    },

    restore: async (id: string): Promise<ApiResponse<boolean>> => {
        return apiFetch(`/media/${id}/restore`, {
            method: 'POST',
        });
    },

    getUsage: async (id: string): Promise<ApiResponse<MediaUsage[]>> => {
        return apiFetch(`/media/${id}/usage`);
    },

    replace: async (oldId: string, newId: string, archiveOld: boolean) => {
        return await apiFetch<boolean>('/media/swap', {
            method: 'POST',
            body: JSON.stringify({ oldMediaId: oldId, newMediaId: newId, archiveOld }),
        });
    },

    replaceContent: async (id: string, formData: FormData) => {
        return await apiFetch<MediaFile>(`/media/${id}/replace`, {
            method: 'POST',
            body: formData,
        }, true); // isUpload=true: use 10 min timeout
    },

    runCleanup: async (): Promise<ApiResponse<number>> => {
        return await apiFetch<number>('/media/cleanup', {
            method: 'POST',
        });
    },

    // ---- Chunked / resumable upload (for files past the Cloudflare 100 MB per-request cap) ----
    // Flow: chunkInit -> chunkUpload (per part) -> chunkComplete. Each request stays under 100 MB.
    chunkInit: async (data: { fileName: string; totalSize: number; totalChunks: number; sha256?: string }): Promise<ApiResponse<{ uploadId: string; chunkSize: number }>> => {
        return await apiFetch('/media/upload/init', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    chunkUpload: async (uploadId: string, index: number, blob: Blob): Promise<ApiResponse<null>> => {
        // Raw body: the server reads the request stream directly. apiFetch labels it JSON, which the
        // server ignores. isUpload=true gives the 10 min timeout.
        return await apiFetch(`/media/upload/${uploadId}/chunk/${index}`, {
            method: 'PUT',
            body: blob,
        }, true);
    },

    chunkStatus: async (uploadId: string): Promise<ApiResponse<{ uploadId: string; receivedChunks: number[]; totalChunks: number }>> => {
        return await apiFetch(`/media/upload/${uploadId}/status`);
    },

    chunkComplete: async (uploadId: string, data: {
        displayName: string; supplier_Code: string; fileName?: string; durationSec?: number;
        ratio?: string; fileSizeKb?: number; remark1?: string; remark2?: string; endDate?: string;
    }): Promise<ApiResponse<MediaFile>> => {
        return await apiFetch(`/media/upload/${uploadId}/complete`, {
            method: 'POST',
            body: JSON.stringify(data),
        }, true);
    },

    chunkAbort: async (uploadId: string): Promise<ApiResponse<unknown>> => {
        return await apiFetch(`/media/upload/${uploadId}`, {
            method: 'DELETE',
        });
    },
};
