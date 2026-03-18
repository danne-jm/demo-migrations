import axios from 'axios';
const apiClient = axios.create({
    baseURL: '/api/v1',
    timeout: 10000
});
export const getHealth = async () => {
    const { data } = await apiClient.get('/health');
    return data;
};
export const getPublicConfig = async () => {
    const { data } = await apiClient.get('/config/public');
    return data;
};
