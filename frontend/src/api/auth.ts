import { api } from "./client";
export interface User{
    id: number;
    username: string;
    email: string;
    is_online: boolean;
    is_typing_in: number | null;
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

export async function registerUser(data: {
    username: string;
    email?: string;
    password?: string;
    password_confirm?: string;
}): Promise<{user: User; message: string}> {
    const response = await api.post('auth/register/', data);
    return response.data;
}

export async function sendHeartbeat(typinInRoomId: number | null): Promise<void> {
    await api.post('auth/heartbeat/', {
        typing_in_room_id : typinInRoomId,
    });
}