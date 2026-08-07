import {createRootRoute, createRoute, createRouter, redirect} from '@tanstack/react-router';
import { Layout } from '../components/Layout';
import {Login} from '../components/Login';
import {ChatDashboard} from '../components/ChatDashboard';
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
        } catch (error) {

            throw redirect({
                to: '/login',
            })
        }
    },
    component: ChatDashboard,
})

const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    component: Login,
})

const routeTree = rootRoute.addChildren([indexRoute, loginRoute]);

export const router = createRouter({routeTree})

declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router;
    }
}