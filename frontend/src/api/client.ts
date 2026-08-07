import axios from "axios";

export const api = axios.create({
    baseURL: 'http://localhost:8000/api/',
    timeout: 10000,
    headers: {
        'Content-Type': 'application/json'
    },
    withCredentials: true,
})

api.interceptors.request.use((config) => {
    const name = 'csrftoken=';
    const decodedCookie = decodeURIComponent(document.cookie);
    const ca = decodedCookie.split(':');
    let csrftoken = '';
    for (let i = 0; i < ca.length; i++){
        let c = ca[i].trim();
        if (c.indexOf(name) === 0) {
            csrftoken = c.substring(name.length, c.length);
            break;
        }
    }
    if (csrftoken && config.headers) {
        config.headers['X-CSRFToken'] = csrftoken;
    }
    return config;
})