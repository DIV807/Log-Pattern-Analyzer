FROM nginx:alpine

# Copy the static HTML frontend
COPY log_pattern_analyzer.html /usr/share/nginx/html/index.html

# Nginx config — proxy /api/* to backend
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
