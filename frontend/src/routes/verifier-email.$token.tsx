import { createFileRoute } from '@tanstack/react-router'
import { VerifyEmailPage } from '@/components/VerifyEmailPage'

export const Route = createFileRoute('/verifier-email/$token')({ component: VerifyEmailPage })
