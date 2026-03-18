# puppet/manifests/site.pp
# Assign the filebeat class to all nodes (or specific node groups).

# Apply to every agent node
node default {
  class { 'filebeat':
    api_host => 'log-analyzer.internal',  # Change to your analyzer host/IP
    api_port => 3000,
    log_dir  => '/var/log/puppet',
  }
}

# Example: apply only to web servers
# node /^web\d+\.prod\.example\.com$/ {
#   class { 'filebeat':
#     api_host => 'log-analyzer.internal',
#   }
# }
