import React from "react";
import ReactDOM from "react-dom/client";
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import { RouterProvider } from "@tanstack/react-router";
import {router} from './routes/routes';
import { UserSocketProvider } from './hooks/SocketProvider';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 5,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <UserSocketProvider>
        <RouterProvider router={router}/>
      </UserSocketProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
