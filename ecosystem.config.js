module.exports = {
    apps: [
        {
            name: "signage-api",
            script: "dotnet",
            args: "watch run --urls http://0.0.0.0:8862",
            cwd: "./src/SignageUnicorn.Api",
            watch: false,
            shell: true,
            env: {
                ASPNETCORE_ENVIRONMENT: "Development"
            }
        },
        {
            name: "signage-web",
            script: "npm",
            args: "run dev -- -p 8865",
            cwd: "./src/signage-unicorn-web",
            watch: false,
            shell: true,
            env: {
                NODE_ENV: "development"
            }
        }
    ]
};
