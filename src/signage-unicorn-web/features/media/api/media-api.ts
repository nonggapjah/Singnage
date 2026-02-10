import { apiFetch, ApiResponse } from '@/lib/api-fetch';
import { MediaFile, MediaUploadRequest, MediaUsage } from '../types/media';

export const mediaApi = {
    getAll: async (filters?: { searchTerm?: string, supplierCode?: string, remark1?: string, remark2?: string, status?: string, mediaType?: string }): Promise<ApiResponse<MediaFile[]>> => {
        const params = new URLSearchParams();
        if (filters?.searchTerm) params.append('searchTerm', filters.searchTerm);
        if (filters?.supplierCode) params.append('supplierCode', filters.supplierCode);
        if (filters?.remark1) params.append('remark1', filters.remark1);
        if (filters?.remark2) params.append('remark2', filters.remark2);
        if (filters?.status) params.append('status', filters.status);
        if (filters?.mediaType) params.append('mediaType', filters.mediaType);

        const queryString = params.toString();
        return apiFetch(`/media${queryString ? `?${queryString}` : ''}`);
    },

    upload: async (data: MediaUploadRequest | FormData): Promise<ApiResponse<MediaFile>> => {
        const isFormData = data instanceof FormData;
        return apiFetch('/media', {
            method: 'POST',
            body: isFormData ? data : JSON.stringify(data),
        });
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
        });
    },
};
