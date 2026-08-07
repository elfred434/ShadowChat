import { api } from "./client";
import type { User } from "./auth";

export async function getUsers(): Promise<User[]> {
    const response = await api.get<User []>('users/');
    return response.data
}