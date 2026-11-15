FROM node:20-alpine

# Install utilities, python3, bash, shadow, sudo, and php for full lab compatibility
RUN apk add --no-cache iputils busybox-extras python3 bash shadow sudo php && \
    chmod u+s /bin/su

# Create the user 'james' with the exact password from the notes
RUN useradd -m -s /bin/bash james && \
    echo 'james:JamesPassword2026!' | chpasswd

# Configure sudo rights for 'james' to run php as root without password (GTFOBins escape)
RUN echo "james ALL=(root) NOPASSWD: /usr/bin/php" > /etc/sudoers.d/james && \
    chmod 0440 /etc/sudoers.d/james

# Setup directory matching the notes configuration path
RUN mkdir -p /var/www/html && \
    echo '<?php $db_user = "james"; $db_pass = "JamesPassword2026!"; ?>' > /var/www/html/config.php

# Create the final system root flag
RUN mkdir -p /root && \
    echo "AXINOR{hacked_axinor_system_compromised_2026}" > /root/root.txt

WORKDIR /app

# Copy server code
COPY server.js .

# Create uploads directory with writable permissions
RUN mkdir -p uploads && chmod 777 uploads

EXPOSE 80

CMD ["node", "server.js"]
