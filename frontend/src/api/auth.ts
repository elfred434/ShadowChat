import { api } from "./client";
export interface User{
    id: number;
    username: string;
    email: string;
}

export async function getCurrentUser(): Promise<User> {
    const  response = await api.get<User>('auth/me/');
    return response.data;
}

export async function loginUser(username: string, password: string): Promise<{user: User; message: string}> {
    const response = await api.post('auth/login/', {username, password});
    return response.data
}

export async function logoutUser(): Promise<void> {
    await api.post('auth/logout/');
}