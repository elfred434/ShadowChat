import  React,{ useState } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { registerUser } from "../api/auth";
import { apiErrorMessage } from "../api/client";

export function Register() {
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword]= useState('');
    const [passwordConfirm, setPasswordConfirm] = useState('');
    const [errorMsg, setErrorMag] = useState('');

    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const registerMutation = useMutation({
        mutationFn: () => registerUser({
            username,
            email,
            password,
            password_confirm: passwordConfirm
        }),
        onSuccess: () => {
            queryClient.invalidateQueries({queryKey: ['currentUser']});
            navigate({to: '/'});
        },
        onError: (err: unknown) => {
            setErrorMag(apiErrorMessage(err, "Erreur lors de l'inscription. Réessayez"));
        }
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMag('');

        if (password.length < 6) {
            setErrorMag('Le mot de passe doit contenier au moins sic caractères');
            return;
        }
        if (password != passwordConfirm) {
            setErrorMag('Les mots de passe ne correspondent pas');
            return;
        }

        registerMutation.mutate();
    };
    return (
    <div className="flex items-center justify-center h-full bg-gray-100 px-4">
      <form onSubmit={handleSubmit} className="bg-white p-8 rounded-xl shadow-md w-full max-w-md border border-gray-200">
        <h2 className="text-2xl font-bold mb-2 text-center text-gray-800">Créer un compte</h2>
        <p className="text-sm text-center text-gray-500 mb-6">Rejoignez OmbreChat aujourd'hui !</p>

        {errorMsg && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 text-sm rounded-lg border border-red-200">
            {errorMsg}
          </div>
        )}

        <div className="mb-4">
          <label className="block text-gray-700 text-sm font-semibold mb-1.5">Nom d'utilisateur</label>
          <input
            type="text"
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-gray-50"
            placeholder="Saisissez un pseudo"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={registerMutation.isPending}
            required
          />
        </div>

        <div className="mb-4">
          <label className="block text-gray-700 text-sm font-semibold mb-1.5">Adresse email (optionnelle)</label>
          <input
            type="email"
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-gray-50"
            placeholder="votre-email@exemple.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={registerMutation.isPending}
          />
        </div>

        <div className="mb-4">
          <label className="block text-gray-700 text-sm font-semibold mb-1.5">Mot de passe</label>
          <input
            type="password"
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-gray-50"
            placeholder="6 caractères minimum"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={registerMutation.isPending}
            required
          />
        </div>

        <div className="mb-6">
          <label className="block text-gray-700 text-sm font-semibold mb-1.5">Confirmez le mot de passe</label>
          <input
            type="password"
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-gray-50"
            placeholder="Saisissez à nouveau le mot de passe"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            disabled={registerMutation.isPending}
            required
          />
        </div>

        <button
          type="submit"
          disabled={registerMutation.isPending}
          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg transition duration-200 disabled:bg-indigo-400 text-sm shadow-sm"
        >
          {registerMutation.isPending ? 'Création du compte...' : 'S\'inscrire'}
        </button>

        <p className="mt-6 text-center text-xs text-gray-500">
          Vous avez déjà un compte ?{' '}
          <Link to="/login" className="text-indigo-600 hover:underline font-semibold">
            Se connecter
          </Link>
        </p>
      </form>
    </div>
  );
}