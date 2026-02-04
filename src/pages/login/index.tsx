import { SignIn } from "@clerk/clerk-react";

export const Login = () => {
  return (
    <div className="flex min-h-svh items-center justify-center px-6 py-8">
      <SignIn routing="path" path="/login" />
    </div>
  );
};
