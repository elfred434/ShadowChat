import {api} from './client';
import type { User } from './auth';

export interface Message{
    id: number;
    rom: number;
    sender: User;
    content: string;
    created_at: string;
}

export async function getMessages(roomId: number): Promise<Message[]> {
    const response = await api.get<Message[]>(`messages/?room_id=${roomId}`);
    return response.data;
}
export async function sendMessages(roomId: number, content: string): Promise<Message> {
    const response = await api.post<Message>(`messages/`, {
        room: roomId,
        content: content,
    });
    return response.data
}