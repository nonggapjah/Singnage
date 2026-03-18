module.exports = {
    apps: [
        {
            name: "signage-api",
            script: "dotnet",
            args: "bin/Debug/net8.0/SignageUnicorn.Api.dll --urls http://127.0.0.1:8862",
            cwd: "./src/SignageUnicorn.Api",
            watch: false,
            shell: true,
            env: {
                ASPNETCORE_ENVIRONMENT: "Development"
            }
        },
        {
            name: "signage-web",
            script: "node_modules/next/dist/bin/next",
            args: "start -p 8865",
            cwd: "./src/signage-unicorn-web",
            watch: false,
            env: {
                NODE_ENV: "production",
                PORT: "8865",
                NEXT_PUBLIC_API_URL: "/api/v1"
            }
        }
    ]
};
