import {createRootRoute, createRoute, createRouter, redirect} from '@tanstack/react-router';
import { Layout } from '../components/Layout';
import {Login} from '../components/Login';
import {ChatDashboard} from '../components/ChatDashboard';
import { Register } from '../components/Register';
import { JoinInvitePage } from '../components/JoinInvitePage';
import { getCurrentUser } from '../api/auth';

export const rootRoute = createRootRoute({
    component: Layout,
});

export const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    beforeLoad: async () => {
        try {
            await getCurrentUser();
        } catch {
            throw redirect({ to: '/login' })
        }
    },
    validateSearch: (search: Record<string, unknown>): { room?: number } => ({
        room: typeof search.room === 'string' && search.room ? Number(search.room) : undefined,
    }),
    component: ChatDashboard,
})

const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    component: Login,
})

export const registerRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/register',
    component: Register,
});

export const joinInviteRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/rejoindre/$token',
    component: JoinInvitePage,
});

const routeTree = rootRoute.addChildren([indexRoute, loginRoute, registerRoute, joinInviteRoute]);

export const router = createRouter({routeTree})

declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router;
    }
}
