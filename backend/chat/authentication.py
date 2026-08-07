# backend/chat/authentication.py
from rest_framework.authentication import SessionAuthentication

class CsrfExemptSessionAuthentication(SessionAuthentication):
    """
    Classe d'authentification par session qui désactive la vérification CSRF.
    Idéal pour le développement cross-origin (React sur un port, Django sur un autre).
    """
    def enforce_csrf(self, request):
        return  # Court-circuite la vérification CSRF