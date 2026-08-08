import React , {useState} from "react";
import {useNavigate, Link} from '@tanstack/react-router';
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { loginUser } from "../api/auth";
export function Login(){
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [errorMag, setErrorMag] = useState('');
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const loginMutation = useMutation({
        mutationFn: () => loginUser(username, password),
        onSuccess: () => {
            queryClient.invalidateQueries({queryKey: ['currentUser']});
            navigate({ to: '/'});
        },
        onError: (err: any) => {
            setErrorMag(err.response?.data?.error || 'Erreur lors de la connexion.' );
        }
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        // alert(`Connexion simulée pour ${username}`);
        // navigate({to: '/'});
        setErrorMag('');
        loginMutation.mutate();
    }

    return(
        <div className="flex items-center justify-center h-full">
            <form action="" onSubmit={handleSubmit} className="bg-white p-8 rounded-lg shadow-md w-full max-w-sm">
                <h2 className="text-2xl font-bold mb-6 text-center text-gray-800">
                    Connexion
                </h2>
                {
                    errorMag && (
                        <div className="mb-4 gb-red-100 text-red-700 text-sm rounded-lg border-red-200">
                            {errorMag}

                        </div>
                    )
                }
                <div className="mb-4">
                    <label htmlFor="" className="block text-gray-700 text-sm font-bold mb-2 ">
                        Nom d'utilisateurs
                    </label>
                    <input type="text"
                    className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required />
                    
                </div>
                <div className="mb-6">
                    <label htmlFor="" className="block text-gray-700 text-sm font-bold mb-2">
                        Mot de passe
                    </label>
                    <input type="password" name="" id=""
                    className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required />
                </div>
                <button type="submit"
                disabled={loginMutation.isPending}
                className="w-full bg-indigo-600  hover:gb-indigo-700 text-white font-bold py-2 px-4 rounded-lg transition duration-200">
                    {loginMutation.isPending ? 'Connexion en cours': 'Se connecter'}
                </button>
                <p className="mt-6 text-center text-xs text-gray-500">
                    Vous n'avez pas de compte ? {''}
                    <Link to="/register" className="text-indigo-600 hover:underline font-semiblod">
                        Créer un compte
                    </Link>
                </p>
            </form>
        </div>
    )
}