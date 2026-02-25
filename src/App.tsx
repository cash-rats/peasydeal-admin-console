import { Authenticated, Refine } from "@refinedev/core";
import { RefineKbar, RefineKbarProvider } from "@refinedev/kbar";

import routerProvider, {
  DocumentTitleHandler,
  NavigateToResource,
  UnsavedChangesNotifier,
} from "@refinedev/react-router";
import dataProvider from "@refinedev/simple-rest";
import { useAuth } from "@clerk/clerk-react";
import React from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useParams } from "react-router";
import "./App.css";
import { ErrorComponent } from "./components/refine-ui/layout/error-component";
import { Layout } from "./components/refine-ui/layout/layout";
import { Toaster } from "./components/refine-ui/notification/toaster";
import { useNotificationProvider } from "./components/refine-ui/notification/use-notification-provider";
import { ThemeProvider } from "./components/refine-ui/theme/theme-provider";
import { FileText, Sparkles } from "lucide-react";
import {
  BlogPostCreate,
  BlogPostEdit,
  BlogPostList,
  BlogPostShow,
} from "./pages/blog-posts";
import {
  CategoryCreate,
  CategoryEdit,
  CategoryList,
  CategoryShow,
} from "./pages/categories";
import {
  AiProductDraftCreate,
  AiProductDraftList,
  AiProductDraftShow,
} from "./pages/products/ai-import";
import { Login } from "./pages/login";
import { createAuthProvider } from "./auth-provider";
import { setAuthTokenProvider } from "./lib/auth-token";

function AuthTokenBridge() {
  const { getToken } = useAuth();

  React.useEffect(() => {
    setAuthTokenProvider(() => getToken());
    return () => setAuthTokenProvider(null);
  }, [getToken]);

  return null;
}

function useClerkAuthProvider() {
  const { getToken, signOut } = useAuth();

  return React.useMemo(
    () =>
      createAuthProvider({
        getToken,
        signOut,
      }),
    [getToken, signOut]
  );
}

function LegacyAiImportDraftRedirect() {
  const params = useParams();
  const draftId = params.id;

  if (!draftId) {
    return <Navigate to="/products/drafts" replace />;
  }

  return <Navigate to={`/products/drafts/${draftId}`} replace />;
}

function App() {
  const authProvider = useClerkAuthProvider();

  return (
    <BrowserRouter>
      <AuthTokenBridge />
      <RefineKbarProvider>
        <ThemeProvider>
          <Refine
            dataProvider={dataProvider("https://api.fake-rest.refine.dev")}
            notificationProvider={useNotificationProvider()}
            routerProvider={routerProvider}
            authProvider={authProvider}
            resources={[
              {
                name: "blog_posts",
                list: "/blog-posts",
                create: "/blog-posts/create",
                edit: "/blog-posts/edit/:id",
                show: "/blog-posts/show/:id",
                meta: {
                  canDelete: true,
                },
              },
              {
                name: "categories",
                list: "/categories",
                create: "/categories/create",
                edit: "/categories/edit/:id",
                show: "/categories/show/:id",
                meta: {
                  canDelete: true,
                },
              },
              {
                name: "product_drafts",
                list: "/products/drafts",
                show: "/products/drafts/:id",
                meta: {
                  label: "Product Drafts",
                  icon: <FileText className="h-4 w-4" />,
                },
              },
              {
                name: "ai_import",
                list: "/products/ai-import",
                meta: {
                  label: "AI Import",
                  icon: <Sparkles className="h-4 w-4" />,
                },
              },
            ]}
            options={{
              syncWithLocation: true,
              warnWhenUnsavedChanges: true,
              projectId: "x3b9Ua-yIONaz-rV1zQj",
            }}
          >
            <Routes>
              <Route path="/login/*" element={<Login />} />
              <Route
                element={
                  <Authenticated key="protected" redirectOnFail="/login">
                    <Layout>
                      <Outlet />
                    </Layout>
                  </Authenticated>
                }
              >
                <Route
                  index
                  element={<NavigateToResource resource="blog_posts" />}
                />
                <Route path="/blog-posts">
                  <Route index element={<BlogPostList />} />
                  <Route path="create" element={<BlogPostCreate />} />
                  <Route path="edit/:id" element={<BlogPostEdit />} />
                  <Route path="show/:id" element={<BlogPostShow />} />
                </Route>
                <Route path="/categories">
                  <Route index element={<CategoryList />} />
                  <Route path="create" element={<CategoryCreate />} />
                  <Route path="edit/:id" element={<CategoryEdit />} />
                  <Route path="show/:id" element={<CategoryShow />} />
                </Route>
                <Route path="/products">
                  <Route path="ai-import" element={<AiProductDraftCreate />} />
                  <Route
                    path="ai-import/create"
                    element={<Navigate to="/products/ai-import" replace />}
                  />
                  <Route path="ai-import/:id" element={<LegacyAiImportDraftRedirect />} />
                  <Route path="drafts" element={<AiProductDraftList />} />
                  <Route path="drafts/:id" element={<AiProductDraftShow />} />
                </Route>
                <Route path="*" element={<ErrorComponent />} />
              </Route>
            </Routes>

            <Toaster />
            <RefineKbar />
            <UnsavedChangesNotifier />
            <DocumentTitleHandler />
          </Refine>
        </ThemeProvider>
      </RefineKbarProvider>
    </BrowserRouter>
  );
}

export default App;
