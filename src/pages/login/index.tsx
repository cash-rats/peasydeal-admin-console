import { SignIn, useAuth } from "@clerk/clerk-react";
import { useEffect } from "react";
import { useNavigate } from "react-router";

export const Login = () => {
  const { isSignedIn, isLoaded } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      navigate("/", { replace: true });
    }
  }, [isLoaded, isSignedIn, navigate]);

  return (
    <div className="flex min-h-svh items-center justify-center px-6 py-8">
      <SignIn routing="path" path="/login" />
    </div>
  );
};
