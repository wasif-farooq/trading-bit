FROM aerospike/aerospike-server:latest

# Copy the aerospike configuration file into the image
# This prevents the container from modifying the host file
# Build context is project root, so path is relative to that
COPY aerospike.conf /etc/aerospike/aerospike.conf

# Remove the template file to prevent entrypoint from overwriting our config
# The entrypoint script processes aerospike.template.conf and overwrites aerospike.conf
RUN rm -f /etc/aerospike/aerospike.template.conf

# The base image already has the entrypoint configured
# No need to override it

