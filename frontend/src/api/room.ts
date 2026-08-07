import { api } from "./client";
import type { User } from "./auth";

export interface Room{
    id:number;
    name: string | null;
    is_group: boolean;
    participants: User[];
    last_message: {
        id: number;
        content: string;
        sender: User;
        created_at: string;
    } | null;
    created_at: string;
    updated_at: string;
}

export async function getRooms(): Promise<Room[]> {
    const response = await api.get<Room[]>('rooms/');
    return response.data;
}

export async function createRoom(data: {name?:string; is_group: boolean; participant_ids: number[]}): Promise<Room> {
    const response = await api.post<Room>('rooms/', data);    return response.data;
}