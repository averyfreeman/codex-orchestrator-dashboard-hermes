import io
import pathlib
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import sys
sys.path.insert(0,str(pathlib.Path(__file__).parent))
import fleet_artifacts as artifacts
import codex_sync

class ArtifactTests(unittest.TestCase):
    def test_large_executable_is_verified_private_and_repeatable(self):
        with tempfile.TemporaryDirectory() as root:
            root=pathlib.Path(root); source=root/'source';source.mkdir()
            binary=source/'native';binary.write_bytes(b'\x7fELF'+b'x'*(2*1024*1024));binary.chmod(0o755)
            path,digest=artifacts.pack(source,root/'stage')
            self.assertEqual(artifacts.pack(source,root/'stage')[1],digest)
            self.assertTrue(artifacts.unpack(path,digest,root/'target'))
            self.assertFalse(artifacts.unpack(path,digest,root/'target'))
            self.assertEqual((root/'target/native').stat().st_mode&0o777,0o700)
            with self.assertRaises(ValueError):artifacts.unpack(path,'0'*64,root/'bad')

    def test_unsafe_members_are_rejected_before_extraction(self):
        for name,kind in [('../escape',tarfile.REGTYPE),('/absolute',tarfile.REGTYPE),('link',tarfile.SYMTYPE)]:
            with self.subTest(name=name),tempfile.TemporaryDirectory() as root:
                root=pathlib.Path(root);archive=root/'bad.tar.gz'
                with tarfile.open(archive,'w:gz') as tar:
                    entry=tarfile.TarInfo(name);entry.type=kind;entry.size=1 if kind==tarfile.REGTYPE else 0;entry.linkname='/tmp/outside'
                    tar.addfile(entry,io.BytesIO(b'x') if entry.size else None)
                with self.assertRaises(ValueError):artifacts.unpack(archive,artifacts.checksum(archive),root/'target')
                self.assertFalse((root/'target').exists())

    def test_small_script_executable_metadata_survives_json_transfer(self):
        with tempfile.TemporaryDirectory() as root:
            root=pathlib.Path(root);source=root/'source';source.mkdir();script=source/'run';script.write_text('#!/bin/sh\nexit 0\n');script.chmod(0o755)
            files,error=codex_sync._collect_regular_tree(source)
            self.assertIsNone(error);self.assertTrue(files['run'].startswith('exec:'))
            target=root/'target';codex_sync._atomic_write(target,codex_sync._decode_file(files['run']),0o700)
            self.assertEqual(target.stat().st_mode&0o777,0o700)

    def test_mcp_and_role_layers_transfer_without_native_app_env(self):
        with tempfile.TemporaryDirectory() as root:
            home=pathlib.Path(root);config=home/'config.toml'
            config.write_text('''[mcp_servers.fs-mcp]
command = "HOME/.local/bin/fs-mcp"
[mcp_servers.fs-mcp.env]
FS_MCP_ALLOWED_DIRECTORIES = "HOME"
API_TOKEN = "leave-on-host"
[mcp_servers.node_repl.env]
NATIVE_APP_PATH = "/Applications/HostApp"
[agents.worker]
description = "Implementation worker"
config_file = "worker.config.toml"
'''.replace('HOME',str(home)))
            portable=codex_sync._toml_state(config,'config.toml',home)['portable']
            self.assertIn('mcp_servers.fs-mcp.command',portable)
            self.assertIn('agents.worker.config_file',portable)
            self.assertNotIn('leave-on-host',str(portable));self.assertNotIn('HostApp',str(portable))
            patched=codex_sync._patch_toml_key(config.read_text(),'mcp_servers."fs-mcp"','command','updated')
            self.assertEqual(__import__('tomllib').loads(patched)['mcp_servers']['fs-mcp']['command'],'updated')

    def test_repeat_run_detects_corruption_and_does_not_adopt_partial_state(self):
        with tempfile.TemporaryDirectory() as root:
            root=pathlib.Path(root);source=root/'source';source.mkdir();(source/'data').write_text('approved')
            archive,digest=artifacts.pack(source,root/'stage');target=root/'target'
            artifacts.unpack(archive,digest,target);(target/'data').write_text('changed')
            with self.assertRaises(ValueError):artifacts.unpack(archive,digest,target)
            self.assertFalse(list(root.glob('.fleet-artifact-*')))

    def test_identity_mismatch_refuses_inspection_before_reading_host_config(self):
        request={'operation':'inspect','identity':{'hostname':'different','system':'Unknown','machine':'unknown'}}
        with patch('sys.stdin',io.StringIO(__import__('json').dumps(request)+'\n')), patch('sys.stdout',new_callable=io.StringIO) as output, patch.object(codex_sync,'inspect') as inspect:
            self.assertEqual(codex_sync.main(),1)
            inspect.assert_not_called()
            self.assertIn('identity or architecture mismatch',output.getvalue())

    def test_mcp_apply_preserves_target_credentials_and_configuration_permissions(self):
        with tempfile.TemporaryDirectory() as root:
            home=pathlib.Path(root);codex=home/'.codex';codex.mkdir();config=codex/'config.toml'
            config.write_text('[mcp_servers.fs-mcp]\ncommand="old"\n[mcp_servers.fs-mcp.env]\nAPI_TOKEN="host-owned"\n')
            action=[{'name':'config.toml','values':{'mcp_servers.fs-mcp.command':__import__('json').dumps('~/.local/bin/fs-mcp')},'remove':[]}]
            with patch('pathlib.Path.home',return_value=home):codex_sync._apply_configs(codex,action,'00000000-0000-0000-0000-000000000001')
            parsed=__import__('tomllib').loads(config.read_text())
            self.assertEqual(parsed['mcp_servers']['fs-mcp']['env']['API_TOKEN'],'host-owned')
            self.assertEqual(parsed['mcp_servers']['fs-mcp']['command'],str(home/'.local/bin/fs-mcp'))
            self.assertEqual(config.stat().st_mode&0o777,0o600)
