var path = require('path');
module.exports = {
    entry: './src/ts/wildcat.ts',
    output: {
        filename: './dist/wildcat.js',
        libraryTarget: "umd"
    },
    resolve: {
        extensions: ['.webpack.js', '.web.js', '.ts', '.tsx', '.js'],
        alias: {
            "mermaid": path.join(__dirname, "node_modules/mermaid/dist/mermaid.js"),
            "toml": path.join(__dirname, "node_modules/toml/index.js"),
        }
    },
    module: {
        loaders: [
            {
                test: /\.tsx?$/,
                loader: 'ts-loader'
            }
        ]
    }
};
