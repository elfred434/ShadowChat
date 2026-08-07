import {api} from './client';
import type { User } from './auth';

export interface Friendship{
    id:number;
    sender: User;
    receiver: User;
    status: 'pending' | 'accepted' | 'rejected';
    created_at: string;
    updated_at: string;
}

export async function getFriendships(): Promise<Friendship[]> {
    const response = await api.get<Friendship[]>('friendships/');
    return response.data;
}

export async function sendFriendRequest(receiverId: number): Promise<Friendship> {
    const response = await api.post<Friendship>('friendships/send_request/', {
        receiver_id: receiverId
    });
    return response.data;
    
}
export async function acceptFriendRequest(friendshipsId: number): Promise<{status: string}> {
    const response = await api.post<{status: string}>(`friendships/${friendshipsId}/accept/`);
    return response.data;
    
}

export async function rejectFriendRequest(friendshipsId: number): Promise<{status: string}> {
    const response = await api.post<{status: string}>(`friendships/${friendshipsId}/reject/`);
    return response.data;    
}

export async function searchNewFriends(query: string): Promise<User[]> {
    const response = await api.get<User[]>(`users/search_new_friends/?q=${query}`);
    return response.data;
    
}