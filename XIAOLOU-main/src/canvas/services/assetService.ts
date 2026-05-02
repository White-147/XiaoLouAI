import { uploadDataUrlAsFile } from '../../lib/api';

/**
 * Uploads a base64 data URL to the server and returns the file path URL.
 * 
 * @param dataUrl The base64 data URL to upload
 * @param type 'image' | 'video'
 * @param prompt Optional prompt associated with the asset
 * @returns Promise resolving to the Control API signed media URL.
 */
export const uploadAsset = async (
    dataUrl: string,
    type: 'image' | 'video' = 'image',
    prompt: string = ''
): Promise<string> => {
    try {
        // If it's already a server URL (not base64), return it as is
        if (!dataUrl.startsWith('data:')) {
            return dataUrl;
        }

        const uploaded = await uploadDataUrlAsFile(dataUrl, `canvas-${type}`, prompt || `canvas-${type}`);
        return uploaded.urlPath || uploaded.url;
    } catch (error) {
        console.error('Asset upload failed:', error);
        throw error;
    }
};
