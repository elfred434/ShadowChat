import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@/hooks/ThemeProvider'
import { UserSocketProvider } from '@/hooks/SocketProvider'
import { Layout } from '@/components/Layout'
import appCss from '@/styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'description', content: 'ShadowChat — messagerie privée en temps réel' },
      { title: 'ShadowChat' },
    ],
    links: [
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      { rel: 'stylesheet', href: appCss },
    ],
  }),
  shellComponent: RootDocument,
  component: Root,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            // Applique le thème avant l'hydratation pour éviter tout flash.
            __html: `
              (function () {
                try {
                  var stored = localStorage.getItem('shadowchat-theme')
                  var dark = stored === 'dark' || (stored !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)
                  if (dark) document.documentElement.classList.add('dark')
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body className="bg-slate-100 text-gray-900 dark:bg-slate-900 dark:text-gray-100">
        {children}
        {import.meta.env.DEV && (
          <TanStackDevtools
            config={{ position: 'bottom-right' }}
            plugins={[{ name: 'Tanstack Router', render: <TanStackRouterDevtoolsPanel /> }]}
          />
        )}
        <Scripts />
      </body>
    </html>
  )
}

function Root() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <UserSocketProvider>
          <Layout>
            <Outlet />
          </Layout>
        </UserSocketProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

// Client de requêtes unique pour toute l'application (SPA).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 5,
    },
  },
})
