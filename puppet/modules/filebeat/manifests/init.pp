# puppet/modules/filebeat/manifests/init.pp
#
# Puppet module: filebeat
# Installs, configures, and manages Filebeat for log shipping
# to the Log Pattern Analyzer backend.
#
# Usage:
#   include filebeat
#   class { 'filebeat': api_host => 'log-analyzer.example.com' }

class filebeat (
  String  $version       = '8.12.0',
  String  $api_host      = 'localhost',
  Integer $api_port      = 3000,
  String  $log_dir       = '/var/log/puppet',
  Boolean $service_enable = true,
  String  $service_ensure = 'running',
) {

  # ── Package ────────────────────────────────────────────────────────────────
  package { 'filebeat':
    ensure => $version,
  }

  # ── Configuration file ─────────────────────────────────────────────────────
  file { '/etc/filebeat/filebeat.yml':
    ensure  => file,
    owner   => 'root',
    group   => 'root',
    mode    => '0640',
    content => template('filebeat/filebeat.yml.erb'),
    require => Package['filebeat'],
    notify  => Service['filebeat'],
  }

  # ── Log directory — ensure it exists ──────────────────────────────────────
  file { $log_dir:
    ensure => directory,
    owner  => 'puppet',
    group  => 'adm',
    mode   => '0750',
  }

  # ── Service ────────────────────────────────────────────────────────────────
  service { 'filebeat':
    ensure  => $service_ensure,
    enable  => $service_enable,
    require => [Package['filebeat'], File['/etc/filebeat/filebeat.yml']],
  }
}
