import { createFileRoute } from '@tanstack/react-router'
import { ResetPassword } from '@/components/ResetPassword'

export const Route = createFileRoute('/reinitialiser/$token')({ component: ResetPassword })
